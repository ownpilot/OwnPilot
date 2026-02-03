/**
 * Sandbox executor
 * Executes code in an isolated context using Node.js vm module
 */

import { createContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { PluginError, TimeoutError, ValidationError } from '../types/errors.js';
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

/**
 * Sandbox executor for running untrusted code
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
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TimeoutError('sandbox', this.limits.maxExecutionTime));
        }, this.limits.maxExecutionTime);
      });

      const value = await Promise.race([executePromise, timeoutPromise]);
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

      // Handle other errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = this.debug && error instanceof Error ? error.stack : undefined;

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
