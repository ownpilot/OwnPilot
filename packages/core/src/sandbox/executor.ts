/**
 * Sandbox executor
 * Executes code in an isolated context using Node.js vm module
 */

import { createContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import type { PluginError } from '../types/errors.js';
import { TimeoutError, ValidationError } from '../types/errors.js';
import type { PluginId } from '../types/branded.js';
import type {
  SandboxConfig,
  ExecutionContext,
  ExecutionResult,
  SandboxStats,
  ResourceLimits,
  SandboxPermissions,
} from './types.js';
import { DEFAULT_RESOURCE_LIMITS, DEFAULT_PERMISSIONS } from './types.js';
import { buildSandboxContext, validateCode } from './context.js';
import { getErrorMessage } from '../services/error-utils.js';
import { silentCatch } from '../utils/ignore-error.js';

/**
 * Strip host file paths from a stack trace.
 * Removes absolute paths like /home/... and C:\Users\... to prevent
 * path disclosure when sandbox errors are returned in debug mode.
 */
function stripHostPaths(stack: string): string {
  // Strip absolute host paths from sandbox error stack traces.
  // Stack traces from Node.js vm module include paths like:
  //   "Error\n    at plugin:test:sandbox-escape:3:24\n    at Object.<anonymous> (/home/runner/work/...)"
  // We remove all occurrences of these host path patterns.
  return stack
    .replace(/\/home\/[^:\s'")\\]+(:\d+:\d+)?/g, '/<sandbox>$1')
    .replace(/\/Users\/[^:\s'")\\]+(:\d+:\d+)?/g, '/<sandbox>$1')
    .replace(/\/root\/[^:\s'")\\]+(:\d+:\d+)?/g, '/<sandbox>$1')
    .replace(/[A-Z]:\\(?:Users|home|root)[^:\s'")\\]+(:\d+:\d+)?/g, '<sandbox>$1');
}

/**
 * Sandbox executor for running untrusted code.
 *
 * IMPORTANT — `limits.maxMemory` is NOT enforced on this path. This executor
 * runs code in a `node:vm` context, which shares the host process heap; Node
 * provides no per-context memory cap, so a sandbox can allocate until the host
 * itself OOMs. The only mechanism that *can* cap memory is a Worker thread
 * (`worker-sandbox.ts`, via `resourceLimits.maxOldGenerationSizeMb`) — but a
 * Worker can only receive structured-cloneable data, and every production
 * caller injects host *functions* into `globals` (the SSRF-safe `fetch`,
 * `console`, the `config.get`/`callTool` bridges, scoped fs/exec). Those
 * functions cannot cross a thread boundary, so the Worker sandbox cannot host
 * the tool/trigger/agentic code that needs them. Enforcing `maxMemory` here
 * therefore requires either a host-function RPC bridge over the worker port or
 * accepting the loss of those bridges — both are larger design changes.
 *
 * Mitigations in place: `maxCpuTime` (vm timeout), `maxExecutionTime` (wall
 * clock), and `maxOutputSize` bound runaway *time* and *output*. `maxMemory` is
 * advisory on THIS (vm) path.
 *
 * To actually enforce `maxMemory`, use `runInWorkerSandbox` (worker-sandbox.ts):
 * it runs code in a Worker thread with `resourceLimits.maxOldGenerationSizeMb`,
 * so a runaway allocation crashes the worker rather than the host. It supports
 * the standard sandbox globals + scoped fs/exec (rebuilt natively in-worker);
 * host-state bridges (config/`callTool`) are not yet available on that path.
 */
export class SandboxExecutor {
  private readonly pluginId: PluginId;
  private readonly limits: Required<ResourceLimits>;
  private readonly permissions: Required<SandboxPermissions>;
  private readonly customGlobals: Record<string, unknown>;
  private readonly debug: boolean;
  private readonly stats: SandboxStats;
  private cleanupFn: (() => void) | null = null;

  constructor(config: SandboxConfig) {
    this.pluginId = config.pluginId;
    this.limits = { ...DEFAULT_RESOURCE_LIMITS, ...config.limits };
    this.permissions = { ...DEFAULT_PERMISSIONS, ...config.permissions };
    this.customGlobals = config.globals ?? {};
    this.debug = config.debug ?? false;
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
   * Execute code in the sandbox
   */
  async execute<T = unknown>(
    code: string,
    data?: unknown
  ): Promise<Result<ExecutionResult<T>, PluginError | ValidationError | TimeoutError>> {
    const startTime = Date.now();
    const executionId = randomUUID();

    this.stats.totalExecutions++;

    // Validate code first
    const validation = validateCode(code);
    if (!validation.valid) {
      this.stats.failedExecutions++;
      return err(
        new ValidationError(`Code validation failed: ${validation.errors.join(', ')}`, {
          errors: validation.errors.map((e, i) => ({ path: [`error_${i}`], message: e })),
        })
      );
    }

    // Create execution context
    const context: ExecutionContext = {
      pluginId: this.pluginId,
      timestamp: Date.now(),
      executionId,
      data,
    };

    // Build sandbox context
    const logs: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }[] = [];
    const { context: sandboxGlobals, cleanup } = buildSandboxContext(
      this.permissions,
      this.limits,
      {
        ...this.customGlobals,
        __context__: context,
      },
      (level, message) => {
        logs.push({ level, message });
      }
    );
    this.cleanupFn = cleanup;

    try {
      // Create VM context
      const vmContext = createContext(sandboxGlobals, {
        name: `sandbox:${this.pluginId}:${executionId}`,
        codeGeneration: {
          strings: false, // Disable eval-like functions
          wasm: false, // Disable WebAssembly
        },
      });

      // Wrap code in an async IIFE to support async/await
      const wrappedCode = `
        (async () => {
          ${code}
        })()
      `;

      // Compile the script
      const script = new Script(wrappedCode, {
        filename: `plugin:${this.pluginId}`,
        lineOffset: 0,
        columnOffset: 0,
      });

      // Execute with timeout
      const executePromise = new Promise<T>((resolve, reject) => {
        try {
          const result = script.runInContext(vmContext, {
            timeout: this.limits.maxCpuTime,
            displayErrors: true,
            breakOnSigint: true,
          });

          // Handle promise result
          if (result && typeof result.then === 'function') {
            result.then(resolve).catch(reject);
          } else {
            resolve(result as T);
          }
        } catch (error) {
          reject(error);
        }
      });

      // Race against execution timeout
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new TimeoutError('sandbox', this.limits.maxExecutionTime));
        }, this.limits.maxExecutionTime);
      });

      // Race-loser rejection suppression: if the timeout wins, executePromise
      // is still in-flight and may later reject (sandbox code threw after
      // timeout). Promise.race already consumed our subscription, so that
      // late rejection would become an unhandled rejection that the Node
      // runtime escalates. Attach a no-op handler so it stays bounded here.
      executePromise.catch(silentCatch('sandbox.execute.raceLoser'));

      try {
        const value = await Promise.race([executePromise, timeoutPromise]);
        clearTimeout(timeoutId);
        const executionTime = Date.now() - startTime;

        this.stats.successfulExecutions++;
        this.stats.totalExecutionTime += executionTime;
        this.stats.averageExecutionTime =
          this.stats.totalExecutionTime / this.stats.totalExecutions;

        return ok({
          success: true,
          value,
          executionTime,
          resourceUsage: {
            networkRequests: 0,
            fsOperations: 0,
          },
        });
      } catch (error) {
        clearTimeout(timeoutId);
        const executionTime = Date.now() - startTime;
        this.stats.failedExecutions++;
        this.stats.totalExecutionTime += executionTime;
        this.stats.averageExecutionTime =
          this.stats.totalExecutionTime / this.stats.totalExecutions;

        // Check if it was a timeout
        if (error instanceof TimeoutError) {
          this.stats.terminatedCount++;
          return err(error);
        }

        // Check for VM timeout (different from our TimeoutError)
        if (error instanceof Error && error.message.includes('Script execution timed out')) {
          this.stats.terminatedCount++;
          return err(new TimeoutError('sandbox:cpu', this.limits.maxCpuTime));
        }

        // Handle other errors. Note: after C1's host-constructor cleanup, the
        // sandbox uses the VM context's own `Error` constructor, so errors
        // thrown from sandbox code are NOT `instanceof Error` here (different
        // realm). Reach for `.stack` structurally instead of via the brand.
        const errorMessage = getErrorMessage(error);
        const rawStack =
          this.debug && error && typeof error === 'object' && 'stack' in error
            ? (error as { stack?: unknown }).stack
            : undefined;
        let errorStack = typeof rawStack === 'string' ? rawStack : undefined;
        // Strip host paths from stack trace when debug mode is enabled
        if (errorStack) {
          errorStack = stripHostPaths(errorStack);
        }

        return ok({
          success: false,
          error: errorMessage,
          stack: errorStack,
          executionTime,
          resourceUsage: {
            networkRequests: 0,
            fsOperations: 0,
          },
        });
      }
    } finally {
      // Cleanup
      if (this.cleanupFn) {
        this.cleanupFn();
        this.cleanupFn = null;
      }
    }
  }

  /**
   * Execute a function with arguments
   */
  async executeFunction<T = unknown, A extends unknown[] = unknown[]>(
    code: string,
    args: A
  ): Promise<Result<ExecutionResult<T>, PluginError | ValidationError | TimeoutError>> {
    // Wrap the function call
    const wrappedCode = `
      const __fn__ = ${code};
      return __fn__(...__context__.data);
    `;

    return this.execute<T>(wrappedCode, args);
  }

  /**
   * Get execution statistics
   */
  getStats(): Readonly<SandboxStats> {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats.totalExecutions = 0;
    this.stats.successfulExecutions = 0;
    this.stats.failedExecutions = 0;
    this.stats.totalExecutionTime = 0;
    this.stats.averageExecutionTime = 0;
    this.stats.terminatedCount = 0;
  }

  /**
   * Get plugin ID
   */
  getPluginId(): PluginId {
    return this.pluginId;
  }
}

/**
 * Create a sandbox executor
 */
export function createSandbox(config: SandboxConfig): SandboxExecutor {
  return new SandboxExecutor(config);
}

/**
 * Quick execution in a temporary sandbox
 */
export async function runInSandbox<T = unknown>(
  pluginId: PluginId,
  code: string,
  options?: {
    data?: unknown;
    permissions?: SandboxPermissions;
    limits?: ResourceLimits;
  }
): Promise<Result<ExecutionResult<T>, PluginError | ValidationError | TimeoutError>> {
  const sandbox = createSandbox({
    pluginId,
    permissions: options?.permissions,
    limits: options?.limits,
  });

  return sandbox.execute<T>(code, options?.data);
}
