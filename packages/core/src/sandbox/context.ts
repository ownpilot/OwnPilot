/**
 * Sandbox context builder
 * Creates a restricted global context for sandboxed code execution
 */

import { createHash, randomUUID, randomBytes } from 'node:crypto';
import type { SandboxPermissions, ResourceLimits } from './types.js';
import { DEFAULT_PERMISSIONS, DEFAULT_RESOURCE_LIMITS } from './types.js';
// SSRF-safe fetch wrapper (manual redirect following + per-hop private/internal
// address check via DNS-aware isPrivateUrlAsync). dynamic-tool-permissions is a
// leaf module (node:dns + types only), so this import introduces no cycle.
import { createSafeFetch } from '../agent/tools/dynamic-tool-sandbox.js';

/**
 * Resource counter for tracking usage
 */
export class ResourceCounter {
  private networkRequests = 0;
  private fsOperations = 0;
  private readonly limits: Required<ResourceLimits>;

  constructor(limits: ResourceLimits = {}) {
    this.limits = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
  }

  incrementNetwork(): boolean {
    if (this.networkRequests >= this.limits.maxNetworkRequests) {
      return false;
    }
    this.networkRequests++;
    return true;
  }

  incrementFs(): boolean {
    if (this.fsOperations >= this.limits.maxFsOperations) {
      return false;
    }
    this.fsOperations++;
    return true;
  }

  getStats() {
    return {
      networkRequests: this.networkRequests,
      fsOperations: this.fsOperations,
    };
  }

  reset() {
    this.networkRequests = 0;
    this.fsOperations = 0;
  }
}

/**
 * Sandbox console interface (subset of full Console)
 */
interface SandboxConsole {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

/**
 * Build a restricted console object
 */
export function buildConsole(
  onLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void
): SandboxConsole {
  const formatArgs = (args: unknown[]): string => {
    return args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ');
  };

  return {
    log: (...args: unknown[]) => onLog('info', formatArgs(args)),
    info: (...args: unknown[]) => onLog('info', formatArgs(args)),
    warn: (...args: unknown[]) => onLog('warn', formatArgs(args)),
    error: (...args: unknown[]) => onLog('error', formatArgs(args)),
    debug: (...args: unknown[]) => onLog('debug', formatArgs(args)),
  };
}

/**
 * Build restricted crypto utilities
 */
export function buildCrypto(allowed: boolean) {
  if (!allowed) {
    return undefined;
  }

  return {
    randomUUID: () => randomUUID(),
    randomBytes: (size: number) => {
      if (size > 1024) {
        throw new Error('randomBytes size exceeds limit (1024)');
      }
      return randomBytes(size);
    },
    sha256: (data: string) => {
      return createHash('sha256').update(data).digest('hex');
    },
    sha512: (data: string) => {
      return createHash('sha512').update(data).digest('hex');
    },
    /**
     * @deprecated MD5 is cryptographically broken — only retained for legacy
     * interop (e.g. ETags, gravatar). Use sha256/sha512 for integrity and
     * security. This export may be removed in a future release.
     */
    md5: (data: string) => {
      return createHash('md5').update(data).digest('hex');
    },
  };
}

/**
 * Build restricted timer functions
 */
export function buildTimers(allowed: boolean, onTimeout: () => void) {
  if (!allowed) {
    return {
      setTimeout: undefined,
      setInterval: undefined,
      clearTimeout: undefined,
      clearInterval: undefined,
      _cleanup: () => {},
    };
  }

  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();

  return {
    setTimeout: (fn: () => void, delay: number) => {
      // Limit delay to prevent hanging
      const safeDelay = Math.min(delay, 10000);
      const id = setTimeout(() => {
        timeouts.delete(id);
        try {
          fn();
        } catch (error) {
          onTimeout();
          throw error;
        }
      }, safeDelay);
      timeouts.add(id);
      return id;
    },
    setInterval: (fn: () => void, delay: number) => {
      // Limit interval to prevent tight loops
      const safeDelay = Math.max(delay, 100);
      const id = setInterval(() => {
        try {
          fn();
        } catch (error) {
          clearInterval(id);
          intervals.delete(id);
          throw error;
        }
      }, safeDelay);
      intervals.add(id);
      return id;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      clearTimeout(id);
      timeouts.delete(id);
    },
    clearInterval: (id: ReturnType<typeof setInterval>) => {
      clearInterval(id);
      intervals.delete(id);
    },
    _cleanup: () => {
      timeouts.forEach(clearTimeout);
      intervals.forEach(clearInterval);
      timeouts.clear();
      intervals.clear();
    },
  };
}

/**
 * Sandbox-realm Function stub returned from any `.constructor` access on a
 * wrapped host constructor or instance, so the
 * `URL → .constructor → .constructor('return process')()` host-realm RCE
 * chain dead-ends here instead of reaching the real host Function.
 *
 * The stub is itself a Proxy that:
 *  - returns itself for `.constructor` (so the chain stays inside the stub
 *    forever — `STUB.constructor.constructor.constructor === STUB`)
 *  - hides `.bind` / `.apply` / `.call` / `.prototype` (each of those would
 *    leak back to host Function.prototype via the stub's own prototype chain)
 *  - throws on call so dynamic-code attempts fail loudly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SANDBOX_FUNCTION_STUB: any;
{
  const stubTarget = function FunctionConstructorDisabled(): never {
    throw new Error('Function constructor is disabled in the sandbox');
  };
  SANDBOX_FUNCTION_STUB = new Proxy(stubTarget, {
    get(_target, prop) {
      if (prop === 'constructor') return SANDBOX_FUNCTION_STUB;
      if (prop === 'name') return 'FunctionConstructorDisabled';
      if (prop === Symbol.toPrimitive || prop === 'toString') {
        return () => 'function FunctionConstructorDisabled() { [disabled] }';
      }
      // Everything else — `prototype`, `bind`, `apply`, `call`, static slots,
      // arbitrary symbols — is blocked. They would otherwise leak host realm.
      return undefined;
    },
    getPrototypeOf() {
      return null;
    },
    setPrototypeOf() {
      return false;
    },
    apply() {
      throw new Error('Function constructor is disabled in the sandbox');
    },
    construct() {
      throw new Error('Function constructor is disabled in the sandbox');
    },
  });
}

/**
 * Recursive security membrane.
 *
 * Any host-realm value that crosses into the sandbox is wrapped so that NO
 * property or prototype walk can reach the host `Function` constructor — which
 * `codeGeneration.strings:false` does NOT bound (it only governs the VM realm's
 * own Function). Blocking `.constructor` alone is insufficient: a raw host
 * object is reachable via `.prototype`, `Object.getPrototypeOf(x)`, and nested
 * accessors (e.g. `new URL(u).searchParams`), each of whose prototype chain
 * ends at host Function. The membrane closes all of them:
 *   - `.constructor` → throwing {@link SANDBOX_FUNCTION_STUB}
 *   - `getPrototypeOf` → null (dead-ends the chain)
 *   - every returned object/function is recursively hardened
 *   - sandbox callbacks handed to host functions get their host-provided
 *     arguments hardened before the sandbox sees them (e.g. `fetch().then(res…)`)
 *
 * This supersedes the previous per-constructor `.constructor` blocker, which
 * left `.prototype` / `getPrototypeOf` / nested host objects walkable (RCE).
 */
const MEMBRANE_TARGET = Symbol('membraneTarget');
const membraneCache = new WeakMap<object, object>();

function unwrap(value: unknown): unknown {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    const inner = (value as Record<symbol, unknown>)[MEMBRANE_TARGET];
    if (inner !== undefined) return inner;
  }
  return value;
}

/**
 * A sandbox callback handed to a host function: harden the host-provided
 * arguments before the sandbox callback runs, and harden its return value.
 */
function wrapIncomingCallback(fn: (...a: unknown[]) => unknown): (...a: unknown[]) => unknown {
  return function (this: unknown, ...hostArgs: unknown[]): unknown {
    return harden(Reflect.apply(fn, unwrap(this), hostArgs.map(harden)));
  };
}

function toRealArg(a: unknown): unknown {
  return typeof a === 'function'
    ? wrapIncomingCallback(a as (...x: unknown[]) => unknown)
    : unwrap(a);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const membraneHandler: ProxyHandler<any> = {
  get(target, prop) {
    if (prop === MEMBRANE_TARGET) return target;
    if (prop === 'constructor') return SANDBOX_FUNCTION_STUB;
    // Always harden. For a non-configurable, non-writable data property the
    // proxy get-invariant forces the target's exact value to be returned:
    //  - primitives harden to themselves (identity), so the invariant holds;
    //  - objects (e.g. a class constructor's non-writable `.prototype`) harden
    //    to a different proxy, so V8 throws on access — FAIL-CLOSED, which is
    //    exactly what we want: the `.prototype.constructor.constructor` walk
    //    dies with a TypeError instead of reaching the host Function.
    return harden(Reflect.get(target, prop, target));
  },
  getPrototypeOf() {
    return null;
  },
  setPrototypeOf() {
    return false;
  },
  apply(target, thisArg, args) {
    return harden(Reflect.apply(target, unwrap(thisArg), args.map(toRealArg)));
  },
  construct(target, args) {
    return harden(Reflect.construct(target, args.map(toRealArg)));
  },
  has(target, prop) {
    return prop === MEMBRANE_TARGET ? false : Reflect.has(target, prop);
  },
  set(target, prop, value) {
    return Reflect.set(target, prop, unwrap(value), target);
  },
  deleteProperty(target, prop) {
    return Reflect.deleteProperty(target, prop);
  },
  defineProperty() {
    // The sandbox may not reshape host objects.
    return false;
  },
  ownKeys(target) {
    return Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    const d = Reflect.getOwnPropertyDescriptor(target, prop);
    if (!d) return d;
    // Harden any data value. As in get(), a non-configurable/non-writable
    // object value makes V8 throw (fail-closed) rather than leak the raw host
    // object via `getOwnPropertyDescriptor(URL,'prototype').value`.
    if ('value' in d) d.value = harden(d.value);
    return d;
  },
};

/**
 * Wrap a host-realm value behind the membrane. Primitives pass through;
 * objects/functions get a recursively-hardening Proxy (identity-stable via a
 * WeakMap cache so repeated access returns the same wrapper).
 */
function harden<T>(value: T): T {
  if (value === null) return value;
  const t = typeof value;
  if (t !== 'object' && t !== 'function') return value;
  if ((value as unknown) === SANDBOX_FUNCTION_STUB) return value;
  const obj = value as unknown as object;
  const cached = membraneCache.get(obj);
  if (cached) return cached as T;
  // Already a membrane proxy? (its get trap answers MEMBRANE_TARGET)
  if ((obj as Record<symbol, unknown>)[MEMBRANE_TARGET] !== undefined) return value;
  const proxy = new Proxy(obj, membraneHandler);
  membraneCache.set(obj, proxy);
  return proxy as T;
}

/**
 * Build the sandbox global context
 */
export function buildSandboxContext(
  permissions: SandboxPermissions = {},
  limits: ResourceLimits = {},
  customGlobals: Record<string, unknown> = {},
  onLog: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void = () => {}
): { context: Record<string, unknown>; cleanup: () => void } {
  const perms = { ...DEFAULT_PERMISSIONS, ...permissions };
  const resourceCounter = new ResourceCounter(limits);

  // Build timer utilities
  const timers = buildTimers(perms.timers, () => {});

  // Build the context object.
  //
  // CRITICAL — host vs VM realm:
  // `vm.createContext()` gives the sandbox its OWN V8 built-ins (Object, Array,
  // Function, String, Number, Boolean, Date, RegExp, Error and subclasses, JSON,
  // Math, Promise, Symbol, Map, Set, WeakMap, WeakSet, Proxy, Reflect, BigInt,
  // ArrayBuffer, DataView, all typed arrays). Those VM-realm constructors are
  // SAFE: walking `.constructor.constructor` from a VM-realm value lands on the
  // VM-realm Function constructor, which compiles strings inside the VM context
  // (and is blocked by `codeGeneration.strings:false`).
  //
  // HOST-realm constructors injected here are NOT safe — `.constructor.constructor`
  // from a host value lands on the host Function constructor, which compiles
  // strings in the HOST realm with full `process` access. So we must:
  //   1. Not inject anything V8 already provides (redundant escape surface).
  //   2. Wrap the host constructors we DO need to expose (URL, URLSearchParams,
  //      TextEncoder, TextDecoder, and the network constructors) so their
  //      `.constructor` returns a sandbox stub instead of host Function.
  const context: Record<string, unknown> = {
    console: buildConsole(onLog),
    // Stateless coercion utilities — pure functions with no prototype chain leak.
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,

    // Node-only host constructors that V8's per-context globals do NOT provide.
    // Each is Proxy-wrapped so `instance.constructor.constructor` resolves to a
    // sandbox-realm throwing stub instead of the host Function constructor.
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,

    // Timers (if allowed)
    ...(perms.timers
      ? {
          setTimeout: timers.setTimeout,
          setInterval: timers.setInterval,
          clearTimeout: timers.clearTimeout,
          clearInterval: timers.clearInterval,
        }
      : {}),

    // Crypto utilities (if allowed)
    ...(perms.crypto ? { crypto: buildCrypto(true) } : {}),

    // Network utilities (if allowed). The default `fetch` is SSRF-safe by
    // construction (createSafeFetch: blocks private/internal/metadata addresses
    // on every hop, follows redirects manually). Do NOT default to raw
    // globalThis.fetch — a network-permitted sandbox could otherwise reach
    // 169.254.169.254 (cloud metadata → credential theft), localhost, or
    // internal services. The dynamic-tool executor still injects its own
    // per-tool createSafeFetch via customGlobals (better error labelling); this
    // default protects every OTHER consumer (worker-sandbox, extensions, future
    // callers) that grants `network` without wiring one up. `fetch` is also
    // wrapped by the harden() membrane below so the returned host Response's
    // `.constructor.constructor` cannot be walked into host Function; the
    // constructors themselves are wrapped for the same reason.
    ...(perms.network
      ? {
          fetch: createSafeFetch('sandbox'),
          Response: globalThis.Response,
          Request: globalThis.Request,
          Headers: globalThis.Headers,
        }
      : {}),

    // Custom globals
    ...customGlobals,

    // Explicitly undefined dangerous globals
    process: undefined,
    require: undefined,
    module: undefined,
    exports: undefined,
    __dirname: undefined,
    __filename: undefined,
    global: undefined,
    globalThis: undefined,
    eval: undefined,
    Function: undefined, // Prevent dynamic code execution
    Atomics: undefined, // Prevent shared memory attacks
    SharedArrayBuffer: undefined, // Prevent shared memory attacks
  };

  // Harden every injected HOST-realm value behind the recursive membrane so no
  // property/prototype walk from sandbox code can reach the host Function
  // constructor (see harden()). VM-realm intrinsics that createContext provides
  // (Object, Array, JSON, Math, Promise, …) are NOT in this object and are
  // already safe. Must run BEFORE the dangerous-key defineProperty loop below,
  // which makes some keys non-writable. undefined/primitive values pass through.
  for (const key of Object.keys(context)) {
    context[key] = harden(context[key]);
  }

  // NOTE: Prototype freezing is done INSIDE the VM context via SANDBOX_INIT_CODE
  // (see below). Doing Object.freeze(Object.prototype) here would freeze the
  // HOST process prototypes, breaking the entire Node.js runtime.
  // However, Object.defineProperty on the context object is safe — createContext
  // preserves property descriptors, so these become non-writable VM globals.
  const dangerousKeys = [
    'process',
    'require',
    'module',
    'exports',
    '__dirname',
    '__filename',
    'global',
    'globalThis',
    'eval',
    'Function',
    'Atomics',
    'SharedArrayBuffer',
    'Proxy',
    'Reflect',
  ];
  for (const key of dangerousKeys) {
    Object.defineProperty(context, key, {
      value: undefined,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }

  // Cleanup function
  const cleanup = () => {
    timers._cleanup();
    resourceCounter.reset();
  };

  return { context, cleanup };
}

/**
 * Validate code before execution
 * Basic static analysis to prevent obvious attacks
 *
 * NOTE: Prototype freezing via Object.freeze() is NOT used because buildSandboxContext
 * passes the HOST's Object/Array/etc. as sandbox globals. Freezing Object.prototype
 * inside the VM would freeze the HOST's prototype (since Object === host Object).
 * Instead, the sandbox relies on these layered defenses:
 *   1. validateCode() — regex-based static analysis blocks obvious attack patterns
 *   2. codeGeneration: { strings: false } — V8-level block on eval/Function constructor,
 *      which prevents the constructor chain escape [].constructor.constructor('return X')()
 *   3. Object.defineProperty on dangerous keys — makes process/require/etc. non-writable
 *   4. Explicit undefined for dangerous globals in the context object
 *
 * Patterns are centralized in code-validator.ts (single source of truth).
 */
export { validateToolCode as validateCode } from './code-validator.js';
