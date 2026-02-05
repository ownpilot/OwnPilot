/**
 * Sandbox context builder
 * Creates a restricted global context for sandboxed code execution
 */

import { createHash, randomUUID, randomBytes } from 'node:crypto';
import type { SandboxPermissions, ResourceLimits } from './types.js';
import { DEFAULT_PERMISSIONS, DEFAULT_RESOURCE_LIMITS } from './types.js';

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
export interface SandboxConsole {
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

  // Build the context object
  const context: Record<string, unknown> = {
    // Safe globals
    console: buildConsole(onLog),
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    URIError,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    Proxy,
    Reflect,

    // String utilities
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,

    // Typed arrays (for data processing)
    ArrayBuffer,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    DataView,

    // Text encoding
    TextEncoder,
    TextDecoder,

    // URL parsing
    URL,
    URLSearchParams,

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
    ...(perms.crypto
      ? { crypto: buildCrypto(true) }
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

  // NOTE: Prototype freezing is done INSIDE the VM context via SANDBOX_INIT_CODE
  // (see below). Doing Object.freeze(Object.prototype) here would freeze the
  // HOST process prototypes, breaking the entire Node.js runtime.
  // However, Object.defineProperty on the context object is safe — createContext
  // preserves property descriptors, so these become non-writable VM globals.
  const dangerousKeys = [
    'process', 'require', 'module', 'exports', '__dirname', '__filename',
    'global', 'globalThis', 'eval', 'Function', 'Atomics', 'SharedArrayBuffer',
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
