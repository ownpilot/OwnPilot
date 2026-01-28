/**
 * Worker-based sandbox for true process isolation
 * Uses Node.js Worker threads for maximum isolation
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createContext, runInContext, Script } from 'node:vm';
import { randomUUID } from 'node:crypto';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { PluginError, TimeoutError, ValidationError } from '../types/errors.js';
import type { PluginId } from '../types/branded.js';
import type {
  SandboxConfig,
  ExecutionContext,
  ExecutionResult,
  WorkerMessage,
  WorkerState,
  SandboxStats,
} from './types.js';
import { DEFAULT_RESOURCE_LIMITS, DEFAULT_PERMISSIONS } from './types.js';
import { buildSandboxContext, validateCode } from './context.js';

/**
 * Worker code that runs in the isolated thread
 */
function workerMain() {
  if (!parentPort) return;

  const { config } = workerData as { config: SandboxConfig };
  const port = parentPort;

  port.on('message', async (message: WorkerMessage) => {
    if (message.type !== 'execute') return;

    const { code, context } = message;
    const startTime = Date.now();

    try {
      // Build sandbox context
      const { context: sandboxGlobals, cleanup } = buildSandboxContext(
        config.permissions,
        config.limits,
        { __context__: context },
        (level, msg) => {
          port.postMessage({ type: 'log', level, message: msg });
        }
      );

      // Create VM context
      const vmContext = createContext(sandboxGlobals, {
        name: `sandbox:${config.pluginId}:${context.executionId}`,
        codeGeneration: {
          strings: false,
          wasm: false,
        },
      });

      // Wrap code
      const wrappedCode = `(async () => { ${code} })()`;

      // Compile and run
      const script = new Script(wrappedCode, {
        filename: `plugin:${config.pluginId}`,
      });

      const resultPromise = script.runInContext(vmContext, {
        timeout: config.limits?.maxCpuTime ?? DEFAULT_RESOURCE_LIMITS.maxCpuTime,
        displayErrors: true,
      });

      const value = await resultPromise;
      const executionTime = Date.now() - startTime;

      cleanup();

      port.postMessage({
        type: 'result',
        result: {
          success: true,
          value,
          executionTime,
          resourceUsage: { networkRequests: 0, fsOperations: 0 },
        },
      } satisfies WorkerMessage);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = config.debug && error instanceof Error ? error.stack : undefined;

      port.postMessage({
        type: 'result',
        result: {
          success: false,
          error: errorMessage,
          stack: errorStack,
          executionTime,
          resourceUsage: { networkRequests: 0, fsOperations: 0 },
        },
      } satisfies WorkerMessage);
    }
  });

  // Signal ready
  port.postMessage({ type: 'result', result: { success: true, executionTime: 0 } });
}

// Run worker code if this is the worker thread
if (!isMainThread && parentPort) {
  workerMain();
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

  constructor(config: SandboxConfig) {
    this.config = {
      ...config,
      limits: { ...DEFAULT_RESOURCE_LIMITS, ...config.limits },
      permissions: { ...DEFAULT_PERMISSIONS, ...config.permissions },
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
      // Create worker using this file as the worker script
      const workerScript = `
        const { parentPort, workerData } = require('worker_threads');
        const { createContext, runInContext, Script } = require('vm');

        const config = workerData.config;

        parentPort.on('message', async (message) => {
          if (message.type !== 'execute') return;

          const { code, context } = message;
          const startTime = Date.now();

          try {
            const sandboxGlobals = {
              console: {
                log: (...args) => parentPort.postMessage({ type: 'log', level: 'info', message: args.join(' ') }),
                info: (...args) => parentPort.postMessage({ type: 'log', level: 'info', message: args.join(' ') }),
                warn: (...args) => parentPort.postMessage({ type: 'log', level: 'warn', message: args.join(' ') }),
                error: (...args) => parentPort.postMessage({ type: 'log', level: 'error', message: args.join(' ') }),
                debug: (...args) => parentPort.postMessage({ type: 'log', level: 'debug', message: args.join(' ') }),
              },
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
              Map,
              Set,
              Promise,
              __context__: context,
              process: undefined,
              require: undefined,
            };

            const vmContext = createContext(sandboxGlobals, {
              codeGeneration: { strings: false, wasm: false },
            });

            const wrappedCode = '(async () => { ' + code + ' })()';
            const script = new Script(wrappedCode);

            const resultPromise = script.runInContext(vmContext, {
              timeout: config.limits?.maxCpuTime || 5000,
            });

            const value = await resultPromise;
            const executionTime = Date.now() - startTime;

            parentPort.postMessage({
              type: 'result',
              result: { success: true, value, executionTime, resourceUsage: { networkRequests: 0, fsOperations: 0 } },
            });
          } catch (error) {
            const executionTime = Date.now() - startTime;
            parentPort.postMessage({
              type: 'result',
              result: {
                success: false,
                error: error.message || String(error),
                stack: config.debug ? error.stack : undefined,
                executionTime,
                resourceUsage: { networkRequests: 0, fsOperations: 0 },
              },
            });
          }
        });

        parentPort.postMessage({ type: 'result', result: { success: true, executionTime: 0 } });
      `;

      return new Promise((resolve) => {
        this.worker = new Worker(workerScript, {
          eval: true,
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
          `Failed to initialize worker: ${error instanceof Error ? error.message : String(error)}`
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
    }
  }

  /**
   * Update statistics
   */
  private updateStats(result: ExecutionResult): void {
    this.stats.totalExecutions++;
    this.stats.totalExecutionTime += result.executionTime;
    this.stats.averageExecutionTime =
      this.stats.totalExecutionTime / this.stats.totalExecutions;

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
   * Execute code in the worker sandbox
   */
  async execute<T = unknown>(
    code: string,
    data?: unknown
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
export function createWorkerSandbox(config: SandboxConfig): WorkerSandbox {
  return new WorkerSandbox(config);
}
