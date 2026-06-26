/**
 * Worker sandbox — REAL-worker integration tests (build-gated).
 *
 * These spin an actual Worker thread, which can only load the COMPILED
 * `dist/sandbox/sandbox-worker.js`. Under source-mode vitest that file doesn't
 * exist, so the whole suite skips. Run it after building:
 *
 *   pnpm --filter @ownpilot/core build && pnpm --filter @ownpilot/core test -- --run integration
 *
 * This is the acceptance test for memory enforcement: a runaway allocation must
 * kill the worker, NOT the host process.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { PluginId } from '../types/branded.js';
import type { Result } from '../types/result.js';
import type { ExecutionResult } from './types.js';

const DIST = fileURLToPath(new URL('../../dist/sandbox/index.js', import.meta.url));
const DIST_BUILT = existsSync(DIST);
const DTE_DIST = fileURLToPath(
  new URL('../../dist/agent/tools/dynamic-tool-executor.js', import.meta.url)
);

type RunInWorkerSandbox = <T = unknown>(
  pluginId: PluginId,
  code: string,
  options?: {
    data?: unknown;
    limits?: Record<string, number>;
    debug?: boolean;
    hostHandlers?: Record<string, (...args: unknown[]) => unknown | Promise<unknown>>;
    toolProfile?: boolean;
  }
) => Promise<Result<ExecutionResult<T>, Error>>;

async function loadRunner(): Promise<RunInWorkerSandbox> {
  const mod = (await import(pathToFileURL(DIST).href)) as {
    runInWorkerSandbox: RunInWorkerSandbox;
  };
  return mod.runInWorkerSandbox;
}

describe.skipIf(!DIST_BUILT)('WorkerSandbox real-worker integration (build-gated)', () => {
  it('runs code in a real worker thread and returns the value', async () => {
    const runInWorkerSandbox = await loadRunner();
    const result = await runInWorkerSandbox('test:integration' as PluginId, 'return 1 + 2;', {
      limits: { maxCpuTime: 5000, maxExecutionTime: 10000 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.value).toBe(3);
    }
  }, 20000);

  it('rebuilds standard globals (crypto) natively inside the worker', async () => {
    const runInWorkerSandbox = await loadRunner();
    const result = await runInWorkerSandbox(
      'test:integration' as PluginId,
      'return typeof crypto.randomUUID === "function" ? crypto.randomUUID().length : -1;',
      { limits: { maxCpuTime: 5000, maxExecutionTime: 10000 } }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.value).toBe(36); // UUID length
    }
  }, 20000);

  it('ENFORCES maxMemory: a runaway allocation kills the worker, host survives', async () => {
    const runInWorkerSandbox = await loadRunner();
    const code = 'const a = []; for (;;) { a.push(new Array(1_000_000).fill(7)); }';

    const result = await runInWorkerSandbox('test:integration' as PluginId, code, {
      // Tiny heap cap; the loop blows past it almost immediately.
      limits: { maxMemory: 16 * 1024 * 1024, maxCpuTime: 15000, maxExecutionTime: 15000 },
    });

    // The worker must terminate with a failure (OOM exit or CPU-timeout), never
    // succeed — and crucially, reaching this line proves the HOST is still alive
    // (a non-enforced cap would have OOM-crashed this very process instead).
    const failed = !result.ok || result.value.success === false;
    expect(failed).toBe(true);
  }, 25000);

  it('bridges a host-state function over RPC (config-style read round-trips)', async () => {
    const runInWorkerSandbox = await loadRunner();
    const result = await runInWorkerSandbox(
      'test:integration' as PluginId,
      'const v = await config.get("smtp", "host"); return v;',
      {
        limits: { maxCpuTime: 5000, maxExecutionTime: 10000 },
        hostHandlers: {
          // Runs on the MAIN thread; only names + cloneable args/result cross.
          'config.get': (service, field) => `${service}.${field}=mail.example.com`,
        },
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.value).toBe('smtp.host=mail.example.com');
    }
  }, 20000);

  it('tool-profile crypto.createHash survives the membrane (de-risks custom-tool wiring)', async () => {
    const runInWorkerSandbox = await loadRunner();
    // sha256("hello") — proves a stateful Hash object works through
    // buildSandboxContext's membrane (constructor-stub + prototype null).
    const result = await runInWorkerSandbox(
      'test:integration' as PluginId,
      'return crypto.createHash("sha256").update("hello").digest("hex");',
      { limits: { maxCpuTime: 5000, maxExecutionTime: 10000 }, toolProfile: true }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.value).toBe(
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      );
    }
  }, 20000);

  it('tool-profile crypto convenience helpers (sha256/randomUUID) work in-worker', async () => {
    const runInWorkerSandbox = await loadRunner();
    const result = await runInWorkerSandbox(
      'test:integration' as PluginId,
      'return { sha: crypto.sha256("hello"), uuidLen: crypto.randomUUID().length };',
      { limits: { maxCpuTime: 5000, maxExecutionTime: 10000 }, toolProfile: true }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.value).toEqual({
        sha: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        uuidLen: 36,
      });
    }
  }, 20000);

  it('runs a full custom-tool-shaped payload in-worker (utils + crypto + __args__ + RPC)', async () => {
    const runInWorkerSandbox = await loadRunner();
    const code = `
      const hash = utils.hash(__args__.text);
      const key = await config.get("svc", "field");
      const tool = await utils.callTool("greet", { name: __args__.text });
      return { hash, key, greeting: tool.greeting, who: __context__.toolName };
    `;
    const result = await runInWorkerSandbox('test:integration' as PluginId, code, {
      limits: { maxCpuTime: 5000, maxExecutionTime: 10000 },
      toolProfile: true,
      data: { args: { text: 'hello' }, toolContext: { toolName: 'my_tool' } },
      hostHandlers: {
        'config.get': () => 'secret-123',
        'utils.callTool': (_name, args) => ({
          greeting: 'hi ' + (args as { name: string }).name,
        }),
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.value).toEqual({
        hash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        key: 'secret-123',
        greeting: 'hi hello',
        who: 'my_tool',
      });
    }
  }, 20000);

  it('executeDynamicTool routes a real custom tool through the worker when opted in', async () => {
    process.env.OWNPILOT_TOOL_SANDBOX = 'worker';
    try {
      const mod = (await import(pathToFileURL(DTE_DIST).href)) as {
        executeDynamicTool: (
          tool: { name: string; code: string; permissions: string[] },
          args: Record<string, unknown>,
          context: Record<string, unknown>
        ) => Promise<{ content: unknown; isError: boolean }>;
      };

      const tool = {
        name: 'hash_tool',
        code: 'return { hash: utils.hash(args.text), key: await config.get("svc", "field") };',
        permissions: [],
      };
      const context = {
        callId: 'call-1',
        conversationId: null,
        userId: 'user-1',
        getFieldValue: () => 'resolved-key',
      };

      const result = await mod.executeDynamicTool(tool, { text: 'hello' }, context);

      expect(result.isError).toBe(false);
      expect(result.content).toEqual({
        hash: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        key: 'resolved-key',
      });
    } finally {
      delete process.env.OWNPILOT_TOOL_SANDBOX;
    }
  }, 20000);

  it('propagates a host-handler error back into the sandbox', async () => {
    const runInWorkerSandbox = await loadRunner();
    const result = await runInWorkerSandbox(
      'test:integration' as PluginId,
      'try { await utils.callTool("x"); return "no-throw"; } catch (e) { return "caught:" + e.message; }',
      {
        limits: { maxCpuTime: 5000, maxExecutionTime: 10000 },
        hostHandlers: {
          'utils.callTool': () => {
            throw new Error('tool exploded');
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.value).toBe('caught:tool exploded');
    }
  }, 20000);
});
