/**
 * Extension Sandbox Manager
 *
 * Isolates extension tool execution in worker threads with resource limits.
 * Each tool execution gets a fresh VM context inside a worker, preventing
 * extensions from accessing gateway memory or other extensions' state.
 *
 * Trust boundary: Extension tool IPC payloads are serialized over the worker boundary; the casts below bridge between the generic message envelope and the typed tool-call shape. The worker protocol is the trust boundary.
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createContext, Script } from 'node:vm';
import { getLog } from '../log.js';
import { getErrorMessage } from '@ownpilot/core/services';
import { validateToolCode } from '@ownpilot/core/sandbox';

const log = getLog('ExtSandbox');

const DEFAULT_MAX_MEMORY = 128 * 1024 * 1024; // 128MB
const DEFAULT_MAX_EXECUTION_TIME = 30_000; // 30s
const DEFAULT_CPU_TIMEOUT = 10_000; // 10s per script.runInContext

// =============================================================================
// Types
// =============================================================================

interface SandboxExecutionOptions {
  extensionId: string;
  toolName: string;
  code: string;
  args: Record<string, unknown>;
  /** Tools the extension is allowed to call via utils.callTool() */
  grantedPermissions?: string[];
  /** Owner user ID for authorization context */
  ownerUserId?: string;
  /** Max memory in bytes */
  maxMemory?: number;
  /** Max execution time in ms */
  maxExecutionTime?: number;
}

interface SandboxExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime: number;
}

/** Messages sent between main thread and worker  *
 * Trust boundary: Extension tool IPC payloads are serialized over the worker boundary; the casts below bridge between the generic message envelope and the typed tool-call shape. The worker protocol is the trust boundary.
 */
interface WorkerRequest {
  type: 'execute';
  code: string;
  args: Record<string, unknown>;
  extensionId: string;
  toolName: string;
  ownerUserId: string;
  grantedPermissions: string[];
}

interface WorkerResponse {
  type: 'result' | 'callTool' | 'log';
  // result
  success?: boolean;
  value?: unknown;
  error?: string;
  executionTime?: number;
  // callTool request from worker
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  requestId?: string;
  ownerUserId?: string;
  grantedPermissions?: string[];
  // log
  level?: string;
  message?: string;
}

interface CallToolResponse {
  type: 'callToolResult';
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// =============================================================================
// Worker Code (runs in isolated thread)
// =============================================================================

function workerMain() {
  if (!parentPort) return;
  const port = parentPort;

  // Module-level storage for extension identity (set per execution, single-threaded worker)
  let _ownerUserId = 'system';
  let _grantedPermissions: string[] = [];

  port.on('message', async (message: WorkerRequest) => {
    if (message.type !== 'execute') return;

    const { code, args, extensionId, toolName, ownerUserId, grantedPermissions } = message;
    _ownerUserId = ownerUserId ?? 'system';
    _grantedPermissions = grantedPermissions ?? [];
    const startTime = Date.now();

    // Hoisted so the outer finally can detach the per-call response handler
    // even if an error fires after registration.
    let responseHandler: ((msg: CallToolResponse) => void) | null = null;

    try {
      // Build restricted globals for the VM context
      const consoleMethods = {
        log: (...a: unknown[]) =>
          port.postMessage({ type: 'log', level: 'info', message: a.map(String).join(' ') }),
        warn: (...a: unknown[]) =>
          port.postMessage({ type: 'log', level: 'warn', message: a.map(String).join(' ') }),
        error: (...a: unknown[]) =>
          port.postMessage({ type: 'log', level: 'error', message: a.map(String).join(' ') }),
      };

      // Create callTool bridge — sends request to main thread, waits for response
      let callToolCounter = 0;
      const pendingCalls = new Map<
        string,
        { resolve: (v: unknown) => void; reject: (e: Error) => void }
      >();

      const callToolBridge = (
        name: string,
        toolArgs: Record<string, unknown> = {}
      ): Promise<unknown> => {
        const requestId = `ct-${++callToolCounter}`;
        return new Promise((resolve, reject) => {
          pendingCalls.set(requestId, { resolve, reject });
          port.postMessage({
            type: 'callTool',
            toolName: name,
            toolArgs,
            requestId,
            ownerUserId: _ownerUserId,
            grantedPermissions: _grantedPermissions,
          });
        });
      };

      // Handle callTool responses from main thread
      responseHandler = (msg: CallToolResponse) => {
        if (msg.type === 'callToolResult' && msg.requestId) {
          const pending = pendingCalls.get(msg.requestId);
          if (pending) {
            pendingCalls.delete(msg.requestId);
            if (msg.success) {
              pending.resolve(msg.result);
            } else {
              pending.reject(new Error(msg.error ?? 'Tool call failed'));
            }
          }
        }
      };
      port.on('message', responseHandler);

      // Build the sandbox context.
      //
      // SECURITY (RCE-001): do NOT inject ANY host-realm value into the context.
      // vm.createContext() already provides every ECMAScript intrinsic (JSON,
      // Math, Date, Object, Array, RegExp, Error, parseInt, ...) as *context-realm*
      // builtins, whose `.constructor` resolves to the context's own Function —
      // which is disabled by `codeGeneration.strings:false`. Injecting the HOST
      // copies instead let an extension walk e.g.
      //   Math['con'+'structor']('return process')()
      // up to the HOST Function constructor (not bound by this context's codegen
      // flag) and execute arbitrary code in the gateway process — full escape.
      // This was empirically reproducible; the static code-validator alone cannot
      // close it because string-concat property access (`x['con'+'structor']`,
      // `x[a+b]`) is unbounded.
      //
      // The few capabilities the SDK needs that are NOT context intrinsics
      // (console, timers, args, utils.callTool) are host functions, so they are
      // passed under a single `__host` global and immediately re-wrapped as
      // context-realm functions by the bootstrap below, after which `__host` is
      // deleted. The wrappers close over the host refs (unreachable via any
      // property path) and their OWN `.constructor` is the blocked context
      // Function. callTool results and args are deep-cloned through the context's
      // JSON so no host-realm object ever leaks back into the sandbox.
      const hostBridge = {
        log: consoleMethods.log,
        warn: consoleMethods.warn,
        error: consoleMethods.error,
        callTool: callToolBridge,
        listTools: () => callToolBridge('__list_tools__', {}),
        // Narrow timer shims — never hand the sandbox a real host timer handle.
        setTimeout: (cb: () => void, ms: number): number => {
          const h = globalThis.setTimeout(cb, ms);
          return typeof h === 'object' && h !== null ? Number(h) : (h as unknown as number);
        },
        clearTimeout: (id: number): void => {
          globalThis.clearTimeout(id as unknown as NodeJS.Timeout);
        },
      };

      const vmContext = createContext(
        { __host: hostBridge, __argsJson: JSON.stringify(args ?? {}) },
        {
          name: `ext-sandbox:${extensionId}:${toolName}`,
          codeGeneration: { strings: false, wasm: false },
        }
      );

      // Bootstrap: rebuild a safe, context-realm SDK from __host, then sever
      // every host reference. Compiled as a Script (allowed) and run before any
      // extension code. After this runs, `__host`/`__argsJson` are unreachable.
      const BOOTSTRAP = `(() => {
        const h = __host;
        const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
        globalThis.console = Object.freeze({
          log: (...a) => h.log(...a.map(String)),
          warn: (...a) => h.warn(...a.map(String)),
          error: (...a) => h.error(...a.map(String)),
        });
        globalThis.setTimeout = (cb, ms) => h.setTimeout(cb, ms);
        globalThis.clearTimeout = (id) => h.clearTimeout(id);
        globalThis.utils = Object.freeze({
          callTool: async (name, toolArgs) => clone(await h.callTool(name, clone(toolArgs) ?? {})),
          listTools: async () => clone(await h.listTools()),
        });
        globalThis.args = JSON.parse(__argsJson);
        delete globalThis.__host;
        delete globalThis.__argsJson;
      })();`;
      new Script(BOOTSTRAP, { filename: `ext-bootstrap:${extensionId}` }).runInContext(vmContext);

      // Wrap the tool code. `args` and `utils` are read from the context globals
      // established by the bootstrap (NOT passed in as host objects).
      const wrappedCode = `(async () => {
        const module = { exports: {} };
        ${code}
        if (typeof module.exports === 'function') {
          return await module.exports(args, utils);
        }
        return module.exports;
      })()`;

      const script = new Script(wrappedCode, {
        filename: `ext:${extensionId}/${toolName}`,
      });

      const resultPromise = script.runInContext(vmContext, {
        timeout: workerData?.cpuTimeout ?? DEFAULT_CPU_TIMEOUT,
        displayErrors: true,
      });

      const value = await resultPromise;
      const executionTime = Date.now() - startTime;
      port.postMessage({ type: 'result', success: true, value, executionTime });
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      port.postMessage({ type: 'result', success: false, error: errorMessage, executionTime });
    } finally {
      // Always detach the per-call responseHandler. A worker is long-lived
      // and handles many executions; leaving handlers attached on the error
      // path would accumulate listeners on `port` and grow memory over time.
      if (responseHandler) {
        port.removeListener('message', responseHandler);
        responseHandler = null;
      }
    }
  });

  // Signal ready
  port.postMessage({ type: 'result', success: true, executionTime: 0 });
}

// Run worker code if this is the worker thread
if (!isMainThread && parentPort) {
  workerMain();
}

// =============================================================================
// Sandbox Manager (main thread)
// =============================================================================

/** Callback for handling tool calls from sandboxed code  *
 * Trust boundary: Extension tool IPC payloads are serialized over the worker boundary; the casts below bridge between the generic message envelope and the typed tool-call shape. The worker protocol is the trust boundary.
 */
type CallToolHandler = (
  toolName: string,
  args: Record<string, unknown>,
  extensionIdentity: { extensionId: string; ownerUserId: string; grantedPermissions: string[] }
) => Promise<{ success: boolean; result?: unknown; error?: string }>;

/**
 * Trusted worker context — populated by the main thread when a worker is
 * spawned and used as the source of truth for the worker's identity when it
 * requests tool calls via utils.callTool(). The worker itself can echo any
 * ownerUserId it likes, but the main thread will only ever use the values
 * stored in this registry.
 *
 * Trust boundary: Extension tool IPC payloads are serialized over the worker boundary; the casts below bridge between the generic message envelope and the typed tool-call shape. The worker protocol is the trust boundary.
 */
interface WorkerContext {
  extensionId: string;
  ownerUserId: string;
  grantedPermissions: string[];
}

export class ExtensionSandboxManager {
  private callToolHandler: CallToolHandler | null = null;
  /**
   * Map<worker.threadId, WorkerContext> — the trusted identity of each
   * live worker. The callTool bridge message includes ownerUserId /
   * grantedPermissions from the worker; those values are NOT trusted.
   * Looked up by worker.threadId on every callTool message.
   *
   * Entries are removed on worker 'exit' and 'error' so the map stays
   * bounded by the number of in-flight executions.
   */
  private workerRegistry = new Map<number, WorkerContext>();

  /** Set the handler for utils.callTool() calls from sandboxed extensions */
  setCallToolHandler(handler: CallToolHandler): void {
    this.callToolHandler = handler;
  }

  /**
   * Execute extension tool code in an isolated worker thread.
   */
  async execute(options: SandboxExecutionOptions): Promise<SandboxExecutionResult> {
    const {
      extensionId,
      toolName,
      code,
      args,
      grantedPermissions = [],
      ownerUserId = 'system',
      maxMemory = DEFAULT_MAX_MEMORY,
      maxExecutionTime = DEFAULT_MAX_EXECUTION_TIME,
    } = options;

    // F-002: Validate extension code before execution (same as custom/dynamic tools)
    const validation = validateToolCode(code);
    if (!validation.valid) {
      return {
        success: false,
        error: `Code validation failed: ${validation.errors.join('; ')}`,
        executionTime: 0,
      };
    }

    return new Promise<SandboxExecutionResult>((resolve) => {
      const startTime = Date.now();
      let settled = false;

      const settle = (result: SandboxExecutionResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      // Create worker thread with resource limits
      let worker: Worker;
      try {
        worker = new Worker(new URL(import.meta.url), {
          workerData: { cpuTimeout: DEFAULT_CPU_TIMEOUT, ownerUserId, grantedPermissions },
          resourceLimits: {
            maxOldGenerationSizeMb: Math.ceil(maxMemory / (1024 * 1024)),
            maxYoungGenerationSizeMb: 16,
            stackSizeMb: 4,
          },
        });
      } catch (err) {
        settle({
          success: false,
          error: `Failed to create sandbox worker: ${getErrorMessage(err)}`,
          executionTime: Date.now() - startTime,
        });
        return;
      }

      // Plan 04 Step 2 (EXT-002): register the trusted identity for this
      // worker. The worker cannot self-attribute — every callTool lookup
      // resolves ownerUserId / grantedPermissions from this map keyed by
      // worker.threadId. Removed on exit/error below.
      this.workerRegistry.set(worker.threadId, {
        extensionId,
        ownerUserId,
        grantedPermissions: grantedPermissions ?? [],
      });

      // Execution timeout
      const timeout = setTimeout(() => {
        log.warn(`Sandbox timeout for ${extensionId}/${toolName} after ${maxExecutionTime}ms`);
        worker.terminate();
        settle({
          success: false,
          error: `Execution timed out after ${maxExecutionTime}ms`,
          executionTime: maxExecutionTime,
        });
      }, maxExecutionTime);

      let readyReceived = false;

      worker.on('message', async (msg: WorkerResponse) => {
        // First message is the "ready" signal
        if (!readyReceived && msg.type === 'result') {
          readyReceived = true;
          // Send execution request
          worker.postMessage({
            type: 'execute',
            code,
            args,
            extensionId,
            toolName,
            ownerUserId,
            grantedPermissions,
          } satisfies WorkerRequest);
          return;
        }

        if (msg.type === 'log') {
          // Forward logs
          const prefix = `[ext:${extensionId}/${toolName}]`;
          if (msg.level === 'error') log.error(`${prefix} ${msg.message}`);
          else if (msg.level === 'warn') log.warn(`${prefix} ${msg.message}`);
          else log.info(`${prefix} ${msg.message}`);
          return;
        }

        if (msg.type === 'callTool' && msg.requestId && msg.toolName) {
          // Handle callTool from sandboxed code
          if (!this.callToolHandler) {
            worker.postMessage({
              type: 'callToolResult',
              requestId: msg.requestId,
              success: false,
              error: 'No callTool handler registered',
            } satisfies CallToolResponse);
            return;
          }

          // Plan 04 Step 2 (EXT-002): resolve identity from the trusted
          // registry, NOT from the message. The worker can echo any
          // ownerUserId it wants, but the main thread will only ever
          // hand the handler the values recorded at spawn time.
          const trusted = this.workerRegistry.get(worker.threadId);
          if (!trusted) {
            // No registered context — should never happen in practice
            // (the worker is still running and posting messages), but
            // fail closed rather than attributing to a synthetic 'system'
            // user.
            log.error(
              `callTool from unregistered worker threadId=${worker.threadId} ` +
                `for ${extensionId}; refusing to attribute`
            );
            worker.postMessage({
              type: 'callToolResult',
              requestId: msg.requestId,
              success: false,
              error: 'Internal error: worker context not found',
            } satisfies CallToolResponse);
            return;
          }

          // Defense-in-depth audit: if the worker claims a different
          // identity than the one it was spawned with, that's a bug or
          // an attack. Surface it; the handler still gets the trusted
          // values below.
          if (msg.ownerUserId !== undefined && msg.ownerUserId !== trusted.ownerUserId) {
            log.warn(
              `Extension ${trusted.extensionId} worker claimed ` +
                `ownerUserId=${msg.ownerUserId} but was registered as ` +
                `${trusted.ownerUserId} (using registered value)`
            );
          }

          const extensionIdentity = {
            extensionId: trusted.extensionId,
            ownerUserId: trusted.ownerUserId,
            grantedPermissions: trusted.grantedPermissions,
          };

          try {
            const result = await this.callToolHandler(
              msg.toolName,
              msg.toolArgs ?? {},
              extensionIdentity
            );
            worker.postMessage({
              type: 'callToolResult',
              requestId: msg.requestId,
              success: result.success,
              result: result.result,
              error: result.error,
            } satisfies CallToolResponse);
          } catch (err) {
            worker.postMessage({
              type: 'callToolResult',
              requestId: msg.requestId,
              success: false,
              error: getErrorMessage(err),
            } satisfies CallToolResponse);
          }
          return;
        }

        if (msg.type === 'result') {
          clearTimeout(timeout);
          worker.terminate();
          settle({
            success: msg.success ?? false,
            result: msg.value,
            error: msg.error,
            executionTime: msg.executionTime ?? Date.now() - startTime,
          });
        }
      });

      worker.on('error', (err) => {
        clearTimeout(timeout);
        this.workerRegistry.delete(worker.threadId);
        settle({
          success: false,
          error: `Worker error: ${getErrorMessage(err)}`,
          executionTime: Date.now() - startTime,
        });
      });

      worker.on('exit', (exitCode) => {
        clearTimeout(timeout);
        this.workerRegistry.delete(worker.threadId);
        if (!settled) {
          settle({
            success: false,
            error: `Worker exited unexpectedly with code ${exitCode}`,
            executionTime: Date.now() - startTime,
          });
        }
      });
    });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ExtensionSandboxManager | null = null;

export function getExtensionSandbox(): ExtensionSandboxManager {
  if (!instance) {
    instance = new ExtensionSandboxManager();
  }
  return instance;
}

/**
 * Null the singleton. Call during shutdown or reset.
 *
 * Trust boundary: Extension tool IPC payloads are serialized over the worker boundary; the casts below bridge between the generic message envelope and the typed tool-call shape. The worker protocol is the trust boundary.
 */
export function resetExtensionSandbox(): void {
  instance = null;
}
