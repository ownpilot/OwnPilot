/**
 * Extension Sandbox Manager Tests
 *
 * Tests the ExtensionSandboxManager class: successful execution, timeout, errors,
 * worker failures, unexpected exits, and callTool message passing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks via vi.hoisted()
// =============================================================================

const {
  MockWorker,
  mockParentPort,
  mockCreateContext,
  MockScript,
  getLastWorker,
  resetWorkerRegistry,
} = vi.hoisted(() => {
  // Per-instance worker objects stored so each test can access the latest worker
  const workerRegistry: Array<{
    on: ReturnType<typeof vi.fn>;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    _emit: (event: string, ...args: unknown[]) => void;
    _handlers: Record<string, Array<(...args: unknown[]) => void>>;
  }> = [];

  function createWorkerInstance() {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const instance = {
      on: vi.fn(function (event: string, handler: (...args: unknown[]) => void) {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
      }),
      postMessage: vi.fn(),
      terminate: vi.fn(),
      _emit: (event: string, ...args: unknown[]) => {
        const hs = handlers[event] ?? [];
        hs.forEach((h) => h(...args));
      },
      _handlers: handlers,
    };
    return instance;
  }

  // MockWorker must use function keyword so it can be used as constructor
  const MockWorker = vi.fn(function (this: ReturnType<typeof createWorkerInstance>) {
    const inst = createWorkerInstance();
    workerRegistry.push(inst);
    Object.assign(this, inst);
    return inst;
  });

  function getLastWorker() {
    return workerRegistry[workerRegistry.length - 1];
  }

  function resetWorkerRegistry() {
    workerRegistry.length = 0;
  }

  const mockParentPort = {
    on: vi.fn(),
    postMessage: vi.fn(),
    removeListener: vi.fn(),
  };

  const mockCreateContext = vi.fn((globals: Record<string, unknown>) => globals);

  const mockScriptInstance = {
    runInContext: vi.fn(),
  };
  const MockScript = vi.fn(function (this: typeof mockScriptInstance) {
    Object.assign(this, mockScriptInstance);
    return mockScriptInstance;
  });

  return {
    MockWorker,
    mockParentPort,
    mockCreateContext,
    MockScript,
    getLastWorker,
    resetWorkerRegistry,
  };
});

vi.mock('node:worker_threads', () => ({
  Worker: MockWorker,
  isMainThread: true,
  parentPort: mockParentPort,
  workerData: {},
}));

vi.mock('node:vm', () => ({
  createContext: mockCreateContext,
  Script: MockScript,
}));

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@ownpilot/core', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// =============================================================================
// Import after mocks
// =============================================================================

const { ExtensionSandboxManager, getExtensionSandbox } = await import('./extension-sandbox.js');

// =============================================================================
// Helpers
// =============================================================================

type ExecOptions = Parameters<InstanceType<typeof ExtensionSandboxManager>['execute']>[0];

function makeOptions(overrides: Partial<ExecOptions> = {}): ExecOptions {
  return {
    extensionId: 'ext-1',
    toolName: 'myTool',
    code: 'module.exports = function(args) { return args.x + 1; }',
    args: { x: 41 },
    ...overrides,
  };
}

/**
 * Emit the ready signal + an execution result from the worker.
 * Uses Promise.resolve().then() chaining so each step happens in a new microtask
 * after the execute() call registers its handlers.
 */
async function simulateWorkerResult(
  successValue: unknown,
  execTime = 50,
  success = true,
  error?: string
) {
  await Promise.resolve();
  const w = getLastWorker();
  // Ready signal
  w._emit('message', { type: 'result', success: true, executionTime: 0 });
  await Promise.resolve();
  // Execution result
  w._emit('message', {
    type: 'result',
    success,
    value: successValue,
    error,
    executionTime: execTime,
  });
}

// =============================================================================
// Tests
// =============================================================================

describe('ExtensionSandboxManager', () => {
  let manager: InstanceType<typeof ExtensionSandboxManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetWorkerRegistry();
    manager = new ExtensionSandboxManager();
  });

  // ---------------------------------------------------------------------------
  // Singleton
  // ---------------------------------------------------------------------------

  describe('getExtensionSandbox()', () => {
    it('returns the same instance on repeated calls', () => {
      const a = getExtensionSandbox();
      const b = getExtensionSandbox();
      expect(a).toBe(b);
    });
  });

  // ---------------------------------------------------------------------------
  // setCallToolHandler
  // ---------------------------------------------------------------------------

  describe('setCallToolHandler()', () => {
    it('registers a handler without throwing', () => {
      const handler = vi.fn();
      expect(() => manager.setCallToolHandler(handler)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Successful execution
  // ---------------------------------------------------------------------------

  describe('execute() - success', () => {
    it('resolves with success:true and the returned value', async () => {
      const promise = manager.execute(makeOptions());
      await simulateWorkerResult(42, 50);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
      expect(result.error).toBeUndefined();
      expect(result.executionTime).toBe(50);
    });

    it('sends execute message to worker after ready signal', async () => {
      const promise = manager.execute(
        makeOptions({ extensionId: 'ext-x', toolName: 'run', args: { a: 1 } })
      );
      await simulateWorkerResult('ok', 10);
      await promise;

      const w = getLastWorker();
      const executeCall = w.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'execute'
      );
      expect(executeCall).toBeDefined();
      expect((executeCall![0] as { extensionId: string }).extensionId).toBe('ext-x');
      expect((executeCall![0] as { toolName: string }).toolName).toBe('run');
    });

    it('terminates the worker after result is received', async () => {
      const promise = manager.execute(makeOptions());
      await simulateWorkerResult(null, 10);
      await promise;

      const w = getLastWorker();
      expect(w.terminate).toHaveBeenCalled();
    });

    it('handles result with success:false (execution error in sandbox)', async () => {
      const promise = manager.execute(makeOptions());
      await simulateWorkerResult(undefined, 20, false, 'SyntaxError: bad code');
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('SyntaxError: bad code');
    });
  });

  // ---------------------------------------------------------------------------
  // Log forwarding
  // ---------------------------------------------------------------------------

  describe('execute() - log messages', () => {
    it('forwards info log messages from worker and continues to result', async () => {
      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();
      w._emit('message', { type: 'result', success: true, executionTime: 0 }); // ready
      await Promise.resolve();
      w._emit('message', { type: 'log', level: 'info', message: 'hello' });
      await Promise.resolve();
      w._emit('message', { type: 'result', success: true, value: 'done', executionTime: 30 });
      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('forwards error log messages from worker', async () => {
      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();
      w._emit('message', { type: 'result', success: true, executionTime: 0 });
      await Promise.resolve();
      w._emit('message', { type: 'log', level: 'error', message: 'oops' });
      await Promise.resolve();
      w._emit('message', { type: 'result', success: true, value: 1, executionTime: 10 });
      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('forwards warn log messages from worker', async () => {
      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();
      w._emit('message', { type: 'result', success: true, executionTime: 0 });
      await Promise.resolve();
      w._emit('message', { type: 'log', level: 'warn', message: 'careful' });
      await Promise.resolve();
      w._emit('message', { type: 'result', success: true, value: 2, executionTime: 10 });
      const result = await promise;
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Worker error event
  // ---------------------------------------------------------------------------

  describe('execute() - worker error event', () => {
    it('resolves with success:false when worker emits error', async () => {
      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();
      w._emit('error', new Error('out of memory'));
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Worker error: out of memory/);
    });

    it('does not double-settle when error fires after result', async () => {
      const promise = manager.execute(makeOptions());
      await simulateWorkerResult(99, 5);
      const result = await promise;

      // Fire a late error — should be ignored (already settled)
      const w = getLastWorker();
      w._emit('error', new Error('late error'));

      expect(result.success).toBe(true);
      expect(result.result).toBe(99);
    });
  });

  // ---------------------------------------------------------------------------
  // Worker exit event
  // ---------------------------------------------------------------------------

  describe('execute() - worker exit event', () => {
    it('resolves with success:false when worker exits unexpectedly', async () => {
      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();
      w._emit('exit', 137);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Worker exited unexpectedly with code 137/);
    });

    it('does not resolve again when worker exits after successful result', async () => {
      const promise = manager.execute(makeOptions());
      await simulateWorkerResult('x', 5);
      const result = await promise;

      // Post-settle exit should be ignored
      const w = getLastWorker();
      w._emit('exit', 0);

      expect(result.success).toBe(true);
      expect(result.result).toBe('x');
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout
  // ---------------------------------------------------------------------------

  describe('execute() - timeout', () => {
    it('resolves with timeout error when maxExecutionTime elapses', async () => {
      vi.useFakeTimers();

      const promise = manager.execute(makeOptions({ maxExecutionTime: 1000 }));

      // Let execute() run and register handlers
      await Promise.resolve();
      const w = getLastWorker();

      // Send ready signal so the timeout can start
      w._emit('message', { type: 'result', success: true, executionTime: 0 });
      await Promise.resolve();

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(1001);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timed out after 1000ms/);
      expect(result.executionTime).toBe(1000);
      expect(w.terminate).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // Worker constructor failure
  // ---------------------------------------------------------------------------

  describe('execute() - worker creation failure', () => {
    it('resolves with error when Worker constructor throws', async () => {
      // Use function keyword in the implementation to avoid the arrow-fn constructor warning
      MockWorker.mockImplementationOnce(function () {
        throw new Error('unsupported platform');
      });

      const result = await manager.execute(makeOptions());

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Failed to create sandbox worker: unsupported platform/);
    });
  });

  // ---------------------------------------------------------------------------
  // callTool handling
  // ---------------------------------------------------------------------------

  describe('execute() - callTool messages', () => {
    it('responds with error when no callTool handler is registered', async () => {
      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();

      // Ready signal
      w._emit('message', { type: 'result', success: true, executionTime: 0 });
      await Promise.resolve();

      // Worker requests a tool call
      w._emit('message', {
        type: 'callTool',
        toolName: 'search',
        toolArgs: { q: 'hello' },
        requestId: 'ct-1',
      });
      // Allow async handler to complete
      await Promise.resolve();
      await Promise.resolve();

      // Final result
      w._emit('message', { type: 'result', success: true, value: null, executionTime: 20 });
      const result = await promise;

      const callToolResultMsg = w.postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'callToolResult'
      );
      expect(callToolResultMsg).toBeDefined();
      expect((callToolResultMsg![0] as { success: boolean }).success).toBe(false);
      expect((callToolResultMsg![0] as { error: string }).error).toMatch(
        /No callTool handler registered/
      );
      expect(result.success).toBe(true);
    });

    it('calls the registered handler and returns its result', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true, result: { data: 'found' } });
      manager.setCallToolHandler(handler);

      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();

      // Ready
      w._emit('message', { type: 'result', success: true, executionTime: 0 });
      await Promise.resolve();

      // callTool request
      w._emit('message', {
        type: 'callTool',
        toolName: 'lookup',
        toolArgs: { id: '123' },
        requestId: 'ct-2',
      });
      // Allow async handler chain to complete
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).toHaveBeenCalledWith('lookup', { id: '123' });

      const callToolResultMsg = w.postMessage.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as { type: string }).type === 'callToolResult' &&
          (c[0] as { requestId: string }).requestId === 'ct-2'
      );
      expect(callToolResultMsg).toBeDefined();
      expect((callToolResultMsg![0] as { success: boolean }).success).toBe(true);
      expect((callToolResultMsg![0] as { result: { data: string } }).result).toEqual({
        data: 'found',
      });

      // Final result
      w._emit('message', { type: 'result', success: true, value: 'done', executionTime: 10 });
      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('returns error result when callTool handler throws', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('tool failed'));
      manager.setCallToolHandler(handler);

      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();

      // Ready
      w._emit('message', { type: 'result', success: true, executionTime: 0 });
      await Promise.resolve();

      // callTool that will throw
      w._emit('message', {
        type: 'callTool',
        toolName: 'bad_tool',
        toolArgs: {},
        requestId: 'ct-3',
      });
      await Promise.resolve();
      await Promise.resolve();

      const callToolResultMsg = w.postMessage.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as { type: string }).type === 'callToolResult' &&
          (c[0] as { requestId: string }).requestId === 'ct-3'
      );
      expect(callToolResultMsg).toBeDefined();
      expect((callToolResultMsg![0] as { success: boolean }).success).toBe(false);
      expect((callToolResultMsg![0] as { error: string }).error).toBe('tool failed');

      // Final result
      w._emit('message', { type: 'result', success: true, value: null, executionTime: 5 });
      await promise;
    });

    it('ignores callTool messages missing requestId', async () => {
      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();

      // Ready
      w._emit('message', { type: 'result', success: true, executionTime: 0 });
      await Promise.resolve();

      // Missing requestId — should be ignored (no callToolResult sent, no hang)
      w._emit('message', {
        type: 'callTool',
        toolName: 'search',
        toolArgs: {},
        // requestId intentionally omitted
      });
      await Promise.resolve();

      // Final result
      w._emit('message', { type: 'result', success: true, value: 'ok', executionTime: 5 });
      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('ignores callTool messages missing toolName', async () => {
      const promise = manager.execute(makeOptions());
      await Promise.resolve();
      const w = getLastWorker();

      // Ready
      w._emit('message', { type: 'result', success: true, executionTime: 0 });
      await Promise.resolve();

      // Missing toolName — should be ignored
      w._emit('message', {
        type: 'callTool',
        requestId: 'ct-99',
        toolArgs: {},
        // toolName intentionally omitted
      });
      await Promise.resolve();

      // Final result
      w._emit('message', { type: 'result', success: true, value: 'ok', executionTime: 5 });
      const result = await promise;
      expect(result.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Resource limits applied
  // ---------------------------------------------------------------------------

  describe('execute() - resource limits', () => {
    it('passes maxMemory as resourceLimits to Worker', async () => {
      const promise = manager.execute(makeOptions({ maxMemory: 64 * 1024 * 1024 }));
      await simulateWorkerResult(null, 5);
      await promise;

      const workerCtorCall = MockWorker.mock.calls[MockWorker.mock.calls.length - 1];
      const opts = workerCtorCall[1] as { resourceLimits: { maxOldGenerationSizeMb: number } };
      expect(opts.resourceLimits.maxOldGenerationSizeMb).toBe(64);
    });

    it('uses default 128MB when maxMemory is not specified', async () => {
      const promise = manager.execute(makeOptions());
      await simulateWorkerResult(null, 5);
      await promise;

      const workerCtorCall = MockWorker.mock.calls[MockWorker.mock.calls.length - 1];
      const opts = workerCtorCall[1] as { resourceLimits: { maxOldGenerationSizeMb: number } };
      expect(opts.resourceLimits.maxOldGenerationSizeMb).toBe(128);
    });
  });
});
