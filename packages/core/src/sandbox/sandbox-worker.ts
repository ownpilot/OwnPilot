/**
 * Sandbox Worker entry point — runs ONLY inside a Worker thread.
 *
 * This file is spawned by `WorkerSandbox.initialize()` as the worker script.
 * Running untrusted code in a Worker (rather than a same-thread `node:vm`
 * context) is what lets us enforce `maxMemory` via the worker's
 * `resourceLimits.maxOldGenerationSizeMb` — a runaway allocation crashes the
 * worker, not the host gateway.
 *
 * The hardened sandbox globals are rebuilt locally here via the SAME
 * `buildSandboxContext` the vm path uses, so the membrane and the standard
 * globals (crypto, URL, timers, SSRF-safe fetch) are identical — those are all
 * native Node APIs available inside a worker. Scoped `fs`/`exec` are
 * reconstructed from `workspaceDir`. Genuinely host-state functions (config
 * reads, `callTool`) are NOT available on this path yet (Phase 2 adds an RPC
 * bridge for them); callers that need them stay on the vm executor.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { createContext, Script } from 'node:vm';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import type { SandboxConfig, WorkerMessage, ExecutionContext } from './types.js';
import { DEFAULT_RESOURCE_LIMITS } from './types.js';
import { buildSandboxContext } from './context.js';
import { createScopedFs, createScopedExec } from './scoped-apis.js';
import { getErrorMessage } from '../services/error-utils.js';
// Pure utility helpers for the custom-tool profile. context.js already imports
// from this module (createSafeFetch), and this file only ever loads inside a
// worker thread, so this introduces no new dependency or import cycle.
import { createSandboxUtils } from '../agent/tools/dynamic-tool-sandbox.js';

/**
 * Make a value safe to post across the worker boundary. The vm path can return
 * any value (same thread); a Worker can only `postMessage` structured-cloneable
 * data. Sandbox results are expected to be JSON-shaped, so round-trip through
 * JSON; fall back to a string for anything that won't serialize.
 */
function toCloneable(value: unknown): unknown {
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

type WorkerPort = NonNullable<typeof parentPort>;

// --- Host-function RPC (worker side) ----------------------------------------
const RPC_TIMEOUT_MS = 30_000;
const pendingRpc = new Map<
  string,
  {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let rpcSeq = 0;

/** Call a host-state function on the main thread and await its (cloneable) result. */
function rpcCall(port: WorkerPort, fn: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = `rpc-${rpcSeq++}`;
    const timer = setTimeout(() => {
      pendingRpc.delete(callId);
      reject(new Error(`Host call timed out after ${RPC_TIMEOUT_MS}ms: ${fn}`));
    }, RPC_TIMEOUT_MS);
    (timer as { unref?: () => void }).unref?.();
    pendingRpc.set(callId, { resolve, reject, timer });
    port.postMessage({
      type: 'host-call',
      callId,
      fn,
      args: args.map(toCloneable),
    } satisfies WorkerMessage);
  });
}

function handleHostResult(message: Extract<WorkerMessage, { type: 'host-result' }>): void {
  const pending = pendingRpc.get(message.callId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingRpc.delete(message.callId);
  if (message.ok) pending.resolve(message.value);
  else pending.reject(new Error(message.error ?? 'Host call failed'));
}

/**
 * Build async RPC stubs at the given dotted paths, assembled into a nested
 * object: ['config.get','utils.callTool'] → { config: {get}, utils: {callTool} }.
 */
function assembleHostStubs(port: WorkerPort, fns: string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const path of fns) {
    const parts = path.split('.');
    let obj = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]!;
      if (typeof obj[key] !== 'object' || obj[key] === null) obj[key] = {};
      obj = obj[key] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]!] = (...args: unknown[]) => rpcCall(port, path, args);
  }
  return root;
}

/** Deep-merge `source` into `target` (plain objects merge; functions/values overwrite). */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

function runWorker(port: WorkerPort, config: SandboxConfig): void {
  port.on('message', async (message: WorkerMessage) => {
    if (message.type === 'host-result') {
      handleHostResult(message);
      return;
    }
    if (message.type !== 'execute') return;

    const { code, context } = message as { code: string; context: ExecutionContext };
    const startTime = Date.now();

    try {
      const extraGlobals: Record<string, unknown> = { __context__: context };

      // Rebuild scoped fs/exec locally from workspaceDir when permitted. Node
      // fs/child_process are available in the worker, so these need no bridge.
      if (config.workspaceDir) {
        if (config.permissions?.fsRead || config.permissions?.fsWrite) {
          extraGlobals.fs = createScopedFs(config.workspaceDir);
        }
        if (config.permissions?.spawn) {
          extraGlobals.exec = createScopedExec(config.workspaceDir).exec;
        }
      }

      // Custom-tool profile: rebuild the dynamic-tool global shape natively so
      // tool code runs unchanged in the worker. Host-state parts (config reads,
      // callTool) arrive as RPC stubs via hostFns below and merge into utils.
      if (config.toolProfile) {
        // crypto superset — covers the dynamic-tool shape (createHash) AND
        // buildSandboxContext's convenience helpers (sha256/sha512/md5).
        extraGlobals.crypto = {
          randomUUID: () => randomUUID(),
          randomBytes: (size: number) => randomBytes(size),
          createHash: (algorithm: string) => createHash(algorithm),
          sha256: (data: string) => createHash('sha256').update(data).digest('hex'),
          sha512: (data: string) => createHash('sha512').update(data).digest('hex'),
          md5: (data: string) => createHash('md5').update(data).digest('hex'),
        };
        // Pure utils (hash/uuid/encode/date/string helpers). RPC stubs for the
        // host-state utils (getApiKey/callTool/…) deep-merge in via hostFns.
        extraGlobals.utils = createSandboxUtils();
        // The caller passes `{ args, toolContext }` as data; expose them as the
        // __args__/__context__ the tool wrapper expects (overrides the default).
        const d = context.data as { args?: unknown; toolContext?: unknown } | undefined;
        if (d && typeof d === 'object') {
          extraGlobals.__args__ = d.args;
          extraGlobals.__context__ = d.toolContext;
        }
      }

      // Host-state functions bridged over RPC (config reads, callTool, …).
      if (config.hostFns?.length) {
        deepMerge(extraGlobals, assembleHostStubs(port, config.hostFns));
      }

      const { context: sandboxGlobals, cleanup } = buildSandboxContext(
        config.permissions ?? {},
        config.limits ?? {},
        extraGlobals,
        (level, msg) => {
          port.postMessage({ type: 'log', level, message: msg } satisfies WorkerMessage);
        }
      );

      const vmContext = createContext(sandboxGlobals, {
        name: `sandbox:${config.pluginId}:${context.executionId}`,
        codeGeneration: { strings: false, wasm: false },
      });

      const script = new Script(`(async () => { ${code} })()`, {
        filename: `plugin:${config.pluginId}`,
      });

      const value = await script.runInContext(vmContext, {
        timeout: config.limits?.maxCpuTime ?? DEFAULT_RESOURCE_LIMITS.maxCpuTime,
        displayErrors: true,
      });

      cleanup();

      port.postMessage({
        type: 'result',
        result: {
          success: true,
          value: toCloneable(value),
          executionTime: Date.now() - startTime,
          resourceUsage: { networkRequests: 0, fsOperations: 0 },
        },
      } satisfies WorkerMessage);
    } catch (error) {
      port.postMessage({
        type: 'result',
        result: {
          success: false,
          error: getErrorMessage(error),
          stack: config.debug && error instanceof Error ? error.stack : undefined,
          executionTime: Date.now() - startTime,
          resourceUsage: { networkRequests: 0, fsOperations: 0 },
        },
      } satisfies WorkerMessage);
    }
  });

  // Signal ready (mirrors the protocol WorkerSandbox.initialize() waits for).
  port.postMessage({ type: 'result', result: { success: true, executionTime: 0 } });
}

if (parentPort) {
  const { config } = workerData as { config: SandboxConfig };
  runWorker(parentPort, config);
}
