/**
 * Extension Sandbox Manager
 *
 * Isolates extension tool execution in worker threads with resource limits.
 * Each tool execution gets a fresh VM context inside a worker, preventing
 * extensions from accessing gateway memory or other extensions' state.
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createContext, Script } from 'node:vm';
import { getLog } from './log.js';
import { getErrorMessage } from '@ownpilot/core';

const log = getLog('ExtSandbox');

const DEFAULT_MAX_MEMORY = 128 * 1024 * 1024; // 128MB
const DEFAULT_MAX_EXECUTION_TIME = 30_000; // 30s
const DEFAULT_CPU_TIMEOUT = 10_000; // 10s per script.runInContext

// =============================================================================
// Types
// =============================================================================

export interface SandboxExecutionOptions {
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

export interface SandboxExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  executionTime: number;
}

/** Messages sent between main thread and worker */
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
      const responseHandler = (msg: CallToolResponse) => {
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

      // Build the sandbox context
      const sandboxGlobals = {
        console: consoleMethods,
        JSON,
        Math,
        Date,
        URL,
        URLSearchParams,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        Promise,
        Error,
        TypeError,
        RangeError,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
        encodeURI,
        decodeURI,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        // Extension SDK
        args,
        utils: {
          callTool: callToolBridge,
          listTools: () => callToolBridge('__list_tools__', {}),
        },
      };

      const vmContext = createContext(sandboxGlobals, {
        name: `ext-sandbox:${extensionId}:${toolName}`,
        codeGeneration: { strings: false, wasm: false },
      });

      // Wrap the tool code
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

      port.removeListener('message', responseHandler);
      port.postMessage({ type: 'result', success: true, value, executionTime });
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      port.postMessage({ type: 'result', success: false, error: errorMessage, executionTime });
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

/** Callback for handling tool calls from sandboxed code */
export type CallToolHandler = (
  toolName: string,
  args: Record<string, unknown>,
  extensionIdentity: { extensionId: string; ownerUserId: string; grantedPermissions: string[] }
) => Promise<{ success: boolean; result?: unknown; error?: string }>;

export class ExtensionSandboxManager {
  private callToolHandler: CallToolHandler | null = null;

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

          const extensionIdentity = {
            extensionId,
            ownerUserId: msg.ownerUserId ?? 'system',
            grantedPermissions: msg.grantedPermissions ?? [],
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
        settle({
          success: false,
          error: `Worker error: ${getErrorMessage(err)}`,
          executionTime: Date.now() - startTime,
        });
      });

      worker.on('exit', (exitCode) => {
        clearTimeout(timeout);
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
