/**
 * Worker-based sandbox for true process isolation
 * Uses Node.js Worker threads for maximum isolation
 */

import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { PluginError, TimeoutError, ValidationError } from '../types/errors.js';
import type { PluginId } from '../types/branded.js';
import type {
  SandboxConfig,
  SandboxPermissions,
  ResourceLimits,
  ExecutionContext,
  ExecutionResult,
  WorkerMessage,
  WorkerState,
  SandboxStats,
} from './types.js';
import { DEFAULT_RESOURCE_LIMITS, DEFAULT_PERMISSIONS } from './types.js';
import { validateCode } from './context.js';
import { getErrorMessage } from '../services/error-utils.js';

// NOTE: the worker-thread entry point lives in `./sandbox-worker.ts` (spawned
// by `initialize()` below as a real module file). It used to be inlined here as
// a stringified `eval:true` script that did `require('./context.js')`, which
// never resolved in the ESM dist — so the worker path was effectively dead.

/**
 * Host-state functions invoked on the MAIN thread in response to the worker's
 * `host-call` RPCs (e.g. config-center reads, `callTool`). Keyed by the dotted
 * name the sandbox code calls (e.g. 'config.get'). These closures stay on the
 * main thread (they hold host services); only names + cloneable args/results
 * cross the worker boundary.
 */
export type HostHandlers = Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;

/** Best-effort make a value structured-cloneable for posting back to the worker. */
function toCloneableValue(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    try {
      return String(value);
    } catch {
      return undefined;
    }
  }
}

/**
 * Worker-based sandbox executor
 * Provides maximum isolation through separate threads
 */
export class WorkerSandbox {
  private readonly config: SandboxConfig;
  private worker: Worker | null = null;
  private state: WorkerState = 'idle';
  private readonly stats: SandboxStats;
  private currentResolve: ((value: ExecutionResult) => void) | null = null;
  private currentReject: ((error: Error) => void) | null = null;
  private executionTimeout: ReturnType<typeof setTimeout> | null = null;
  /**
   * Synchronous concurrency gate. The worker is single-threaded and
   * `currentResolve`/`currentReject`/`executionTimeout` are singleton slots,
   * so two concurrent `execute()` calls used to race past the `state !== 'idle'`
   * check (both reached it after the lazy-init `await` while state was still
   * idle) and the second overwrote the first's resolver — hanging the first
   * caller's promise forever. The flag + queue below serializes contended
   * calls. An uncontended call runs inline so callers still see the
   * synchronous `worker.postMessage` side-effect that the rest of the codebase
   * (and tests) depend on.
   */
  private executionPending = false;
  private readonly executionQueue: Array<() => void> = [];
  /** Host-state handlers invoked on the main thread for the worker's host-call RPCs. */
  private readonly hostHandlers: HostHandlers;

  constructor(config: SandboxConfig, hostHandlers: HostHandlers = {}) {
    this.hostHandlers = hostHandlers;
    this.config = {
      ...config,
      limits: { ...DEFAULT_RESOURCE_LIMITS, ...config.limits },
      permissions: { ...DEFAULT_PERMISSIONS, ...config.permissions },
      // The worker builds RPC stubs at these dotted paths; the handlers above
      // stay on the main thread (only names cross the boundary).
      hostFns: Object.keys(hostHandlers),
    };
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      terminatedCount: 0,
    };
  }

  /**
   * Initialize the worker
   */
  async initialize(): Promise<Result<void, PluginError>> {
    if (this.worker) {
      return ok(undefined);
    }

    try {
      // Spawn the real worker entry module. `import.meta.url` is this file's
      // compiled location (dist/sandbox/worker-sandbox.js in prod), so the
      // sibling `sandbox-worker.js` resolves correctly. resourceLimits below is
      // what actually enforces maxMemory — a runaway allocation crashes the
      // worker thread, not the host.
      const workerUrl = new URL('./sandbox-worker.js', import.meta.url);

      return new Promise((resolve) => {
        this.worker = new Worker(workerUrl, {
          workerData: { config: this.config },
          resourceLimits: {
            maxOldGenerationSizeMb:
              (this.config.limits?.maxMemory ?? DEFAULT_RESOURCE_LIMITS.maxMemory) / (1024 * 1024),
            maxYoungGenerationSizeMb: 32,
            codeRangeSizeMb: 16,
          },
        });

        this.worker.on('message', (message: WorkerMessage) => {
          this.handleWorkerMessage(message);
        });

        this.worker.on('error', (error) => {
          this.state = 'error';
          if (this.currentReject) {
            this.currentReject(error);
            this.currentReject = null;
            this.currentResolve = null;
          }
        });

        this.worker.on('exit', (code) => {
          this.state = code === 0 ? 'terminated' : 'error';
          if (this.currentReject && code !== 0) {
            this.currentReject(new Error(`Worker exited with code ${code}`));
            this.currentReject = null;
            this.currentResolve = null;
          }
        });

        // Wait for ready signal
        const originalHandler = this.handleWorkerMessage.bind(this);
        this.handleWorkerMessage = (message: WorkerMessage) => {
          if (message.type === 'result') {
            this.handleWorkerMessage = originalHandler;
            this.state = 'idle';
            resolve(ok(undefined));
          }
        };
      });
    } catch (error) {
      return err(
        new PluginError(
          this.config.pluginId,
          `Failed to initialize worker: ${getErrorMessage(error)}`
        )
      );
    }
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(message: WorkerMessage): void {
    switch (message.type) {
      case 'result':
        if (this.currentResolve) {
          this.clearExecutionTimeout();
          const result = message.result;
          this.updateStats(result);
          this.currentResolve(result);
          this.currentResolve = null;
          this.currentReject = null;
          this.state = 'idle';
        }
        break;

      case 'log':
        // Log messages can be handled by a callback if needed
        break;

      case 'error':
        if (this.currentReject) {
          this.clearExecutionTimeout();
          this.currentReject(new Error(message.error));
          this.currentReject = null;
          this.currentResolve = null;
          this.state = 'error';
        }
        break;

      case 'host-call':
        // The worker invoked a bridged host-state function; run the real
        // handler on this (main) thread and post the cloneable result back.
        // Fire-and-forget: many host-calls can be in flight during one
        // execution, each correlated by callId — no shared resolver state.
        void this.handleHostCall(message);
        break;
    }
  }

  private async handleHostCall(
    message: Extract<WorkerMessage, { type: 'host-call' }>
  ): Promise<void> {
    const { callId, fn, args } = message;
    const handler = this.hostHandlers[fn];
    try {
      if (!handler) throw new Error(`No host handler registered for '${fn}'`);
      const value = await handler(...args);
      this.worker?.postMessage({
        type: 'host-result',
        callId,
        ok: true,
        value: toCloneableValue(value),
      } satisfies WorkerMessage);
    } catch (error) {
      this.worker?.postMessage({
        type: 'host-result',
        callId,
        ok: false,
        error: getErrorMessage(error),
      } satisfies WorkerMessage);
    }
  }

  /**
   * Update statistics
   */
  private updateStats(result: ExecutionResult): void {
    this.stats.totalExecutions++;
    this.stats.totalExecutionTime += result.executionTime;
    this.stats.averageExecutionTime = this.stats.totalExecutionTime / this.stats.totalExecutions;

    if (result.success) {
      this.stats.successfulExecutions++;
    } else {
      this.stats.failedExecutions++;
      if (result.error?.includes('timed out')) {
        this.stats.terminatedCount++;
      }
    }
  }

  /**
   * Clear the execution timeout
   */
  private clearExecutionTimeout(): void {
    if (this.executionTimeout) {
      clearTimeout(this.executionTimeout);
      this.executionTimeout = null;
    }
  }

  /**
   * Execute code in the worker sandbox.
   *
   * Uncontended calls run inline so the synchronous `worker.postMessage`
   * side-effect inside the inner Promise constructor still fires before
   * `execute()` returns its Promise to the caller. Contended calls queue
   * behind the in-flight execution and run after it completes.
   */
  async execute<T = unknown>(
    code: string,
    data?: unknown
  ): Promise<Result<ExecutionResult<T>, PluginError | ValidationError | TimeoutError>> {
    if (this.executionPending) {
      await new Promise<void>((resolve) => this.executionQueue.push(resolve));
    }
    this.executionPending = true;
    try {
      return await this.executeOnce<T>(code, data);
    } finally {
      this.executionPending = false;
      const next = this.executionQueue.shift();
      next?.();
    }
  }

  private async executeOnce<T>(
    code: string,
    data: unknown
  ): Promise<Result<ExecutionResult<T>, PluginError | ValidationError | TimeoutError>> {
    // Validate code
    const validation = validateCode(code);
    if (!validation.valid) {
      return err(
        new ValidationError(`Code validation failed: ${validation.errors.join(', ')}`, {
          errors: validation.errors.map((e, i) => ({ path: [`error_${i}`], message: e })),
        })
      );
    }

    // Initialize worker if needed
    if (!this.worker) {
      const initResult = await this.initialize();
      if (!initResult.ok) {
        return initResult as Result<ExecutionResult<T>, PluginError>;
      }
    }

    if (this.state !== 'idle') {
      return err(new PluginError(this.config.pluginId, 'Worker is not ready'));
    }

    const executionId = randomUUID();
    const context: ExecutionContext = {
      pluginId: this.config.pluginId,
      timestamp: Date.now(),
      executionId,
      data,
    };

    this.state = 'running';

    return new Promise((resolve) => {
      this.currentResolve = (result) => resolve(ok(result as ExecutionResult<T>));
      this.currentReject = (error) => {
        resolve(
          ok({
            success: false,
            error: error.message,
            executionTime: 0,
          })
        );
      };

      // Set execution timeout
      const maxTime =
        this.config.limits?.maxExecutionTime ?? DEFAULT_RESOURCE_LIMITS.maxExecutionTime;
      this.executionTimeout = setTimeout(() => {
        this.terminate();
        resolve(err(new TimeoutError('sandbox', maxTime)));
      }, maxTime);

      // Send execute message
      this.worker!.postMessage({
        type: 'execute',
        code,
        context,
      } satisfies WorkerMessage);
    });
  }

  /**
   * Terminate the worker
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.state = 'terminated';
      this.clearExecutionTimeout();
      if (this.currentReject) {
        this.currentReject(new Error('Worker terminated'));
        this.currentReject = null;
        this.currentResolve = null;
      }
    }
  }

  /**
   * Get current state
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Get statistics
   */
  getStats(): Readonly<SandboxStats> {
    return { ...this.stats };
  }

  /**
   * Get plugin ID
   */
  getPluginId(): PluginId {
    return this.config.pluginId;
  }
}

/**
 * Create a worker-based sandbox
 */
export function createWorkerSandbox(
  config: SandboxConfig,
  hostHandlers?: HostHandlers
): WorkerSandbox {
  return new WorkerSandbox(config, hostHandlers);
}

/**
 * Quick one-shot execution in a fresh Worker-isolated sandbox.
 *
 * Mirrors `runInSandbox` but runs in a Worker thread, so `limits.maxMemory` is
 * ENFORCED (the vm-based `runInSandbox` cannot cap memory — see SandboxExecutor
 * docs). Use this for untrusted code that needs only the standard sandbox
 * globals + optional scoped fs/exec (no host-state bridges like config/callTool
 * yet). Spawns a worker, runs once, and terminates it.
 */
export async function runInWorkerSandbox<T = unknown>(
  pluginId: PluginId,
  code: string,
  options?: {
    data?: unknown;
    permissions?: SandboxPermissions;
    limits?: ResourceLimits;
    workspaceDir?: string;
    debug?: boolean;
    /** Host-state functions bridged to the worker over RPC (e.g. config/callTool). */
    hostHandlers?: HostHandlers;
    /** Seed the custom-tool global profile (crypto superset, etc.) in the worker. */
    toolProfile?: boolean;
  }
): Promise<Result<ExecutionResult<T>, PluginError | ValidationError | TimeoutError>> {
  const sandbox = createWorkerSandbox(
    {
      pluginId,
      permissions: options?.permissions,
      limits: options?.limits,
      workspaceDir: options?.workspaceDir,
      debug: options?.debug,
      toolProfile: options?.toolProfile,
    },
    options?.hostHandlers
  );
  try {
    return await sandbox.execute<T>(code, options?.data);
  } finally {
    await sandbox.terminate();
  }
}
