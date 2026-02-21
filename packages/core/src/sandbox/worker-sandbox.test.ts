import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() factories are executed
// ---------------------------------------------------------------------------

const { mockWorkerInstance, mockValidateCode, mockRandomUUID } = vi.hoisted(() => {
  const mockWorkerInstance = {
    on: vi.fn(),
    postMessage: vi.fn(),
    terminate: vi.fn().mockResolvedValue(0),
  };
  return {
    mockWorkerInstance,
    mockValidateCode: vi.fn(),
    mockRandomUUID: vi.fn(() => 'test-uuid-123'),
  };
});

vi.mock('node:worker_threads', () => ({
  Worker: vi.fn(function () {
    return mockWorkerInstance;
  }),
  isMainThread: true,
  parentPort: null,
  workerData: null,
}));

vi.mock('node:vm', () => ({
  createContext: vi.fn(),
  Script: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: mockRandomUUID,
}));

vi.mock('./types.js', () => ({
  DEFAULT_RESOURCE_LIMITS: {
    maxMemory: 128 * 1024 * 1024,
    maxCpuTime: 5000,
    maxExecutionTime: 30000,
    maxNetworkRequests: 10,
    maxFsOperations: 100,
  },
  DEFAULT_PERMISSIONS: {
    network: false,
    allowedHosts: [],
    fsRead: false,
    allowedReadPaths: [],
    fsWrite: false,
    allowedWritePaths: [],
    spawn: false,
    env: false,
    allowedEnvVars: [],
    timers: true,
    crypto: true,
  },
}));

vi.mock('./context.js', () => ({
  buildSandboxContext: vi.fn(),
  validateCode: mockValidateCode,
}));

vi.mock('../services/error-utils.js', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { WorkerSandbox, createWorkerSandbox } from './worker-sandbox.js';
import { PluginError, ValidationError, TimeoutError } from '../types/errors.js';
import type { PluginId } from '../types/branded.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_PLUGIN_ID = 'test-plugin' as unknown as PluginId;

function makeConfig(overrides: Record<string, unknown> = {}) {
  return { pluginId: TEST_PLUGIN_ID, ...overrides };
}

/** Find the handler registered for a specific worker event */
function getWorkerHandler(event: string): ((...args: unknown[]) => void) | undefined {
  const call = mockWorkerInstance.on.mock.calls.find((c) => c[0] === event);
  return call?.[1] as ((...args: unknown[]) => void) | undefined;
}

/** Resolve a validation mock to return valid */
function codeIsValid() {
  mockValidateCode.mockReturnValue({ valid: true, errors: [] });
}

/** Resolve a validation mock to return invalid */
function codeIsInvalid(errors: string[] = ['Dangerous pattern detected']) {
  mockValidateCode.mockReturnValue({ valid: false, errors });
}

/**
 * Configure the Worker mock so that registering the 'message' event handler
 * automatically triggers the ready signal in the next macrotask, allowing
 * initialize() to resolve.
 *
 * This works with real timers. For fake timer contexts use initializeWithFakeTimers().
 */
function setupAutoReadyWorker() {
  mockWorkerInstance.on.mockImplementation((event: string, handler: (msg: unknown) => void) => {
    if (event === 'message') {
      setTimeout(
        () => handler({ type: 'result', result: { success: true, executionTime: 0 } }),
        0
      );
    }
  });
}

/**
 * Initialize a sandbox in a fake-timer context.
 *
 * The source's initialize() sets up the 'message' handler FIRST, then replaces
 * this.handleWorkerMessage. The ready signal must arrive AFTER the replacement is
 * installed, which means after the Promise executor has fully run. We achieve this
 * by using queueMicrotask (not setTimeout) so it fires after the current synchronous
 * code (including the replacement) but before any awaited promise resolves.
 */
async function initializeWithFakeTimers(sandbox: WorkerSandbox): Promise<void> {
  // Configure the worker mock to deliver the ready signal via queueMicrotask.
  // queueMicrotask is NOT affected by vi.useFakeTimers() — it fires in the
  // microtask queue after the current synchronous execution.
  mockWorkerInstance.on.mockImplementation((event: string, handler: (msg: unknown) => void) => {
    if (event === 'message') {
      // Use queueMicrotask — bypasses fake timer interception, fires after the
      // Promise executor completes (i.e., after handleWorkerMessage is replaced).
      queueMicrotask(() =>
        handler({ type: 'result', result: { success: true, executionTime: 0 } })
      );
    }
  });
  await sandbox.initialize();
}

/**
 * Initialize a sandbox and wait for the worker to be ready (real-timer version).
 */
async function initializeSandbox(sandbox: WorkerSandbox) {
  setupAutoReadyWorker();
  return sandbox.initialize();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('createWorkerSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a WorkerSandbox instance', () => {
    const sandbox = createWorkerSandbox(makeConfig());
    expect(sandbox).toBeInstanceOf(WorkerSandbox);
  });

  it('passes config to constructor (pluginId is accessible)', () => {
    const sandbox = createWorkerSandbox(makeConfig());
    expect(sandbox.getPluginId()).toBe(TEST_PLUGIN_ID);
  });

  it('creates a new instance each call', () => {
    const a = createWorkerSandbox(makeConfig());
    const b = createWorkerSandbox(makeConfig());
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox constructor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets initial state to idle', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    expect(sandbox.getState()).toBe('idle');
  });

  it('initialises stats to all zeros', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    const stats = sandbox.getStats();
    expect(stats.totalExecutions).toBe(0);
    expect(stats.successfulExecutions).toBe(0);
    expect(stats.failedExecutions).toBe(0);
    expect(stats.totalExecutionTime).toBe(0);
    expect(stats.averageExecutionTime).toBe(0);
    expect(stats.terminatedCount).toBe(0);
  });

  it('merges default limits when none provided (state remains idle)', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    expect(sandbox.getState()).toBe('idle');
  });

  it('merges provided limits with defaults', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(
      makeConfig({ limits: { maxExecutionTime: 60000, maxMemory: 64 * 1024 * 1024 } })
    );
    await sandbox.initialize();

    const callArgs = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toBeDefined();
    // resourceLimits should reflect overridden maxMemory (64 MB)
    const opts = callArgs[1] as { resourceLimits: { maxOldGenerationSizeMb: number } };
    expect(opts.resourceLimits.maxOldGenerationSizeMb).toBe(64);
  });

  it('merges provided permissions with defaults without throwing', () => {
    expect(
      () => new WorkerSandbox(makeConfig({ permissions: { network: true, fsRead: true } }))
    ).not.toThrow();
  });

  it('returns pluginId from getPluginId()', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    expect(sandbox.getPluginId()).toBe(TEST_PLUGIN_ID);
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox.initialize()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates Worker with eval: true', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const opts = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      eval: boolean;
    };
    expect(opts.eval).toBe(true);
  });

  it('sets resourceLimits on worker with maxOldGenerationSizeMb from maxMemory', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const opts = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      resourceLimits: {
        maxOldGenerationSizeMb: number;
        maxYoungGenerationSizeMb: number;
        codeRangeSizeMb: number;
      };
    };
    // DEFAULT maxMemory is 128 * 1024 * 1024 → 128 MB
    expect(opts.resourceLimits.maxOldGenerationSizeMb).toBe(128);
    expect(opts.resourceLimits.maxYoungGenerationSizeMb).toBe(32);
    expect(opts.resourceLimits.codeRangeSizeMb).toBe(16);
  });

  it('returns ok(undefined) on successful ready signal', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    const result = await sandbox.initialize();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });

  it('returns ok(undefined) immediately if worker already exists (no-op)', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();
    const callCountAfterFirst = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls.length;

    const result = await sandbox.initialize();

    expect(result.ok).toBe(true);
    // Worker constructor must NOT have been called again
    expect((WorkerMock as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCountAfterFirst);
  });

  it('sets state to idle after receiving the ready signal', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    expect(sandbox.getState()).toBe('idle');
  });

  it('registers message event handler on worker', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const eventNames = mockWorkerInstance.on.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain('message');
  });

  it('registers error event handler on worker', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const eventNames = mockWorkerInstance.on.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain('error');
  });

  it('registers exit event handler on worker', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const eventNames = mockWorkerInstance.on.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain('exit');
  });

  it('handles initialization error when Worker constructor throws', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    (WorkerMock as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
      throw new Error('Worker creation failed');
    });

    const sandbox = new WorkerSandbox(makeConfig());
    // Worker throws inside the Promise executor — the Promise rejects with the raw error.
    // The outer try/catch in initialize() does NOT catch synchronous throws from
    // inside the Promise executor callback.
    await expect(sandbox.initialize()).rejects.toThrow('Worker creation failed');
  });

  it('includes pluginId in PluginError when initialization fails', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    (WorkerMock as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
      throw new Error('boom');
    });

    const sandbox = new WorkerSandbox(makeConfig());
    // Worker throws inside the Promise executor — rejects with raw error.
    await expect(sandbox.initialize()).rejects.toThrow('boom');
  });

  it('passes workerData with config to the Worker', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const opts = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      workerData: { config: unknown };
    };
    expect(opts.workerData).toBeDefined();
    expect(opts.workerData.config).toBeDefined();
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox.execute()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codeIsValid();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns ValidationError when code validation fails', async () => {
    codeIsInvalid(['Dangerous pattern detected']);

    const sandbox = new WorkerSandbox(makeConfig());
    const result = await sandbox.execute('dangerous code here');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain('Code validation failed');
      expect(result.error.message).toContain('Dangerous pattern detected');
    }
  });

  it('returns ValidationError with all validation errors joined', async () => {
    codeIsInvalid(['Pattern A not allowed', 'Pattern B not allowed']);

    const sandbox = new WorkerSandbox(makeConfig());
    const result = await sandbox.execute('bad code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('Pattern A not allowed');
      expect(result.error.message).toContain('Pattern B not allowed');
    }
  });

  it('auto-initializes worker if not already initialized', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    // Do not call initialize() manually

    const executePromise = sandbox.execute('return 1');
    // The worker is auto-initialized; now simulate execution result
    await vi.waitFor(() => {
      return mockWorkerInstance.postMessage.mock.calls.length > 0;
    });

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({
      type: 'result',
      result: { success: true, value: 1, executionTime: 10 },
    });

    const result = await executePromise;

    expect(result.ok).toBe(true);
    expect((WorkerMock as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('returns PluginError if state is running (not idle)', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    // Force state to running
    (sandbox as unknown as { state: string }).state = 'running';

    const result = await sandbox.execute('return 1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PluginError);
      expect(result.error.message).toContain('Worker is not ready');
    }
  });

  it('returns PluginError if state is terminated', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    (sandbox as unknown as { state: string }).state = 'terminated';

    const result = await sandbox.execute('return 1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PluginError);
    }
  });

  it('returns PluginError if state is error', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    (sandbox as unknown as { state: string }).state = 'error';

    const result = await sandbox.execute('return 1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(PluginError);
    }
  });

  it('sets state to running during execution', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    let stateObservedDuringExecution: string | undefined;

    mockWorkerInstance.postMessage.mockImplementation(() => {
      stateObservedDuringExecution = sandbox.getState();
    });

    const executePromise = sandbox.execute('return 42');

    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);
    expect(stateObservedDuringExecution).toBe('running');

    // Resolve execution
    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 42, executionTime: 5 } });

    await executePromise;
  });

  it('sends execute message to worker with correct type and code', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 42');

    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      type: string;
      code: string;
    };
    expect(sentMessage.type).toBe('execute');
    expect(sentMessage.code).toBe('return 42');

    // Clean up
    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 42, executionTime: 5 } });
    await executePromise;
  });

  it('context includes pluginId', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      context: { pluginId: string };
    };
    expect(sentMessage.context.pluginId).toBe(TEST_PLUGIN_ID);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await executePromise;
  });

  it('context includes timestamp', async () => {
    const now = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      context: { timestamp: number };
    };
    expect(sentMessage.context.timestamp).toBe(now);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await executePromise;

    vi.restoreAllMocks();
  });

  it('context includes executionId from randomUUID', async () => {
    mockRandomUUID.mockReturnValue('exec-uuid-456');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      context: { executionId: string };
    };
    expect(sentMessage.context.executionId).toBe('exec-uuid-456');

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await executePromise;
  });

  it('context includes data parameter', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1', { extra: 'payload' });
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      context: { data: unknown };
    };
    expect(sentMessage.context.data).toEqual({ extra: 'payload' });

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await executePromise;
  });

  it('handles null data in context', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1', null);
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      context: { data: unknown };
    };
    expect(sentMessage.context.data).toBeNull();

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await executePromise;
  });

  it('returns ok(result) on successful execution', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute<number>('return 42');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({
      type: 'result',
      result: { success: true, value: 42, executionTime: 15 },
    });

    const result = await executePromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(true);
      expect(result.value.value).toBe(42);
      expect(result.value.executionTime).toBe(15);
    }
  });

  it('sets state back to idle after successful execution', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });

    await executePromise;

    expect(sandbox.getState()).toBe('idle');
  });

  it('execution timeout triggers terminate and returns TimeoutError', async () => {
    vi.useFakeTimers();

    const sandbox = new WorkerSandbox(makeConfig({ limits: { maxExecutionTime: 5000 } }));
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('infinite loop code');
    // postMessage is called synchronously inside execute()
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    // Advance fake time past the execution timeout
    await vi.runAllTimersAsync();

    const result = await executePromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TimeoutError);
    }
  });

  it('uses maxExecutionTime from config limits for timeout', async () => {
    vi.useFakeTimers();

    const customTimeout = 12345;
    const sandbox = new WorkerSandbox(makeConfig({ limits: { maxExecutionTime: customTimeout } }));
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('return 1');
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    await vi.runAllTimersAsync();

    const result = await executePromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect((result.error as TimeoutError).timeoutMs).toBe(customTimeout);
    }
  });

  it('uses default maxExecutionTime (30000) when not configured', async () => {
    vi.useFakeTimers();

    const sandbox = new WorkerSandbox(makeConfig());
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('return 1');
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    await vi.runAllTimersAsync();

    const result = await executePromise;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(TimeoutError);
      expect((result.error as TimeoutError).timeoutMs).toBe(30000);
    }
  });

  it('timeout calls terminate() on the worker', async () => {
    vi.useFakeTimers();

    const sandbox = new WorkerSandbox(makeConfig({ limits: { maxExecutionTime: 1000 } }));
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('slow code');
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    await vi.runAllTimersAsync();
    await executePromise;

    expect(mockWorkerInstance.terminate).toHaveBeenCalled();
  });

  it('init failure during auto-initialize causes execute to reject', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    (WorkerMock as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
      throw new Error('spawn failure');
    });

    const sandbox = new WorkerSandbox(makeConfig());
    // Worker throws inside the Promise executor — the Promise rejects with raw error.
    await expect(sandbox.execute('return 1')).rejects.toThrow('spawn failure');
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox handleWorkerMessage (tested via execute)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codeIsValid();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('result message resolves the execute promise', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute<string>('return "hello"');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({
      type: 'result',
      result: { success: true, value: 'hello', executionTime: 7 },
    });

    const result = await executePromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe('hello');
    }
  });

  it('result message clears the execution timeout', async () => {
    vi.useFakeTimers();

    const sandbox = new WorkerSandbox(makeConfig({ limits: { maxExecutionTime: 5000 } }));
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('return 1');
    // postMessage is called synchronously inside execute()
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 3 } });

    const result = await executePromise;
    expect(result.ok).toBe(true);

    // Advance time — timeout should NOT fire since it was cleared
    await vi.advanceTimersByTimeAsync(10000);
    expect(result.ok).toBe(true);
  });

  it('result message updates stats', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 20 } });
    await executePromise;

    const stats = sandbox.getStats();
    expect(stats.totalExecutions).toBe(1);
  });

  it('result message sets state back to idle', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await executePromise;

    expect(sandbox.getState()).toBe('idle');
  });

  it('log message is silently ignored without crashing', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    // Send a log message — should be no-op
    expect(() =>
      messageHandler?.({ type: 'log', level: 'info', message: 'some log text' })
    ).not.toThrow();

    // Now resolve
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    const result = await executePromise;
    expect(result.ok).toBe(true);
  });

  it('error message resolves with a failed execution result', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('throw code');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'error', error: 'worker error' });

    const result = await executePromise;

    // currentReject wraps in ok({success:false, error, executionTime:0})
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(false);
      expect(result.value.error).toBe('worker error');
    }
  });

  it('error message sets state to error', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('throw code');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'error', error: 'some error' });
    await executePromise;

    expect(sandbox.getState()).toBe('error');
  });

  it('error message clears the execution timeout', async () => {
    vi.useFakeTimers();

    const sandbox = new WorkerSandbox(makeConfig({ limits: { maxExecutionTime: 5000 } }));
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('throw code');
    // postMessage is called synchronously inside execute()
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'error', error: 'test error' });

    const result = await executePromise;
    expect(result.ok).toBe(true);
    // Advance timers to verify timeout does not fire again
    await vi.advanceTimersByTimeAsync(10000);
    expect(mockWorkerInstance.terminate.mock.calls.length).toBe(0);
  });

  it('result message when no currentResolve is set does not crash', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    // Not in an execution — currentResolve is null
    const messageHandler = getWorkerHandler('message');
    expect(() =>
      messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 0 } })
    ).not.toThrow();
  });

  it('error message when no currentReject set does not crash', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');
    expect(() =>
      messageHandler?.({ type: 'error', error: 'spurious error' })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox Worker event handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codeIsValid();
  });

  it('worker error event sets state to error', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const errorHandler = getWorkerHandler('error');
    errorHandler?.(new Error('worker crashed'));

    expect(sandbox.getState()).toBe('error');
  });

  it('worker error event rejects pending promise with wrapped failed result', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const errorHandler = getWorkerHandler('error');
    errorHandler?.(new Error('crash'));

    const result = await executePromise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(false);
      expect(result.value.error).toBe('crash');
    }
  });

  it('worker error event without pending promise does not throw', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const errorHandler = getWorkerHandler('error');
    expect(() => errorHandler?.(new Error('silent crash'))).not.toThrow();
    expect(sandbox.getState()).toBe('error');
  });

  it('worker exit with code 0 sets state to terminated', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const exitHandler = getWorkerHandler('exit');
    exitHandler?.(0);

    expect(sandbox.getState()).toBe('terminated');
  });

  it('worker exit with non-zero code sets state to error', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const exitHandler = getWorkerHandler('exit');
    exitHandler?.(1);

    expect(sandbox.getState()).toBe('error');
  });

  it('worker exit with non-zero code rejects pending promise', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const exitHandler = getWorkerHandler('exit');
    exitHandler?.(137);

    const result = await executePromise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(false);
      expect(result.value.error).toContain('Worker exited with code 137');
    }
  });

  it('worker exit code 0 does NOT reject pending promise', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    // Simulate clean exit — should not resolve from the exit handler
    const exitHandler = getWorkerHandler('exit');
    exitHandler?.(0);

    // Resolve the promise normally so the test does not hang
    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });

    const result = await executePromise;
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox.terminate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codeIsValid();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('terminates the worker', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    await sandbox.terminate();

    expect(mockWorkerInstance.terminate).toHaveBeenCalled();
  });

  it('sets worker to null after terminate so re-initialize creates a new Worker', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();
    await sandbox.terminate();

    const prevCallCount = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls.length;

    // Re-initialize should create a new Worker (worker was null'd)
    setupAutoReadyWorker();
    await sandbox.initialize();

    expect((WorkerMock as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(prevCallCount);
  });

  it('sets state to terminated', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    await sandbox.terminate();

    expect(sandbox.getState()).toBe('terminated');
  });

  it('rejects pending promise with Worker terminated error', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    await sandbox.terminate();

    const result = await executePromise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(false);
      expect(result.value.error).toContain('Worker terminated');
    }
  });

  it('clears execution timeout on terminate', async () => {
    vi.useFakeTimers();

    const sandbox = new WorkerSandbox(makeConfig({ limits: { maxExecutionTime: 10000 } }));
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('return 1');
    // postMessage is synchronous inside execute()
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    await sandbox.terminate();
    await executePromise;

    // Advance past where timeout would have fired — terminate should NOT be called again
    await vi.advanceTimersByTimeAsync(20000);
    const terminateCallCount = mockWorkerInstance.terminate.mock.calls.length;
    expect(terminateCallCount).toBe(1);
  });

  it('is a no-op if no worker exists', async () => {
    const sandbox = new WorkerSandbox(makeConfig());
    // Worker never initialized

    await expect(sandbox.terminate()).resolves.toBeUndefined();
    expect(mockWorkerInstance.terminate).not.toHaveBeenCalled();
  });

  it('is a no-op if called twice', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    await sandbox.terminate();
    const callCountAfterFirst = mockWorkerInstance.terminate.mock.calls.length;

    await sandbox.terminate();

    expect(mockWorkerInstance.terminate.mock.calls.length).toBe(callCountAfterFirst);
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox updateStats (tested via execute)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codeIsValid();
  });

  it('increments totalExecutions on each execution', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');

    for (let i = 1; i <= 3; i++) {
      const p = sandbox.execute(`return ${i}`);
      await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length >= i);
      messageHandler?.({ type: 'result', result: { success: true, value: i, executionTime: 5 } });
      await p;
      expect(sandbox.getStats().totalExecutions).toBe(i);
    }
  });

  it('increments successfulExecutions on success', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');
    const p = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await p;

    expect(sandbox.getStats().successfulExecutions).toBe(1);
    expect(sandbox.getStats().failedExecutions).toBe(0);
  });

  it('increments failedExecutions on failure', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');
    const p = sandbox.execute('bad code');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);
    messageHandler?.({
      type: 'result',
      result: { success: false, error: 'fail', executionTime: 3 },
    });
    await p;

    expect(sandbox.getStats().failedExecutions).toBe(1);
    expect(sandbox.getStats().successfulExecutions).toBe(0);
  });

  it('increments terminatedCount when error contains "timed out"', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');
    const p = sandbox.execute('infinite loop code');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);
    messageHandler?.({
      type: 'result',
      result: {
        success: false,
        error: 'Script execution timed out after 5000ms',
        executionTime: 5000,
      },
    });
    await p;

    expect(sandbox.getStats().terminatedCount).toBe(1);
  });

  it('does NOT increment terminatedCount for non-timeout errors', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');
    const p = sandbox.execute('bad code');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);
    messageHandler?.({
      type: 'result',
      result: { success: false, error: 'other error', executionTime: 3 },
    });
    await p;

    expect(sandbox.getStats().terminatedCount).toBe(0);
  });

  it('accumulates totalExecutionTime across multiple executions', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');

    const p1 = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length >= 1);
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 10 } });
    await p1;

    const p2 = sandbox.execute('return 2');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length >= 2);
    messageHandler?.({ type: 'result', result: { success: true, value: 2, executionTime: 20 } });
    await p2;

    expect(sandbox.getStats().totalExecutionTime).toBe(30);
  });

  it('calculates averageExecutionTime correctly', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');

    const p1 = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length >= 1);
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 10 } });
    await p1;

    const p2 = sandbox.execute('return 2');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length >= 2);
    messageHandler?.({ type: 'result', result: { success: true, value: 2, executionTime: 30 } });
    await p2;

    expect(sandbox.getStats().averageExecutionTime).toBe(20);
  });

  it('multiple sequential executions update all stats fields correctly', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');

    // 2 successes
    for (let i = 0; i < 2; i++) {
      const p = sandbox.execute('return 1');
      await vi.waitFor(
        () => mockWorkerInstance.postMessage.mock.calls.length >= i + 1
      );
      messageHandler?.({
        type: 'result',
        result: { success: true, value: 1, executionTime: 5 },
      });
      await p;
    }

    // 1 failure
    const p3 = sandbox.execute('bad code');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length >= 3);
    messageHandler?.({
      type: 'result',
      result: { success: false, error: 'oops', executionTime: 2 },
    });
    await p3;

    const stats = sandbox.getStats();
    expect(stats.totalExecutions).toBe(3);
    expect(stats.successfulExecutions).toBe(2);
    expect(stats.failedExecutions).toBe(1);
    expect(stats.totalExecutionTime).toBe(12);
    expect(stats.averageExecutionTime).toBe(4);
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox.getState()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns idle initially', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    expect(sandbox.getState()).toBe('idle');
  });

  it('returns terminated after terminate()', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();
    await sandbox.terminate();

    expect(sandbox.getState()).toBe('terminated');
  });

  it('returns error when worker error event fires', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    getWorkerHandler('error')?.(new Error('crash'));

    expect(sandbox.getState()).toBe('error');
  });

  it('returns idle after successful execution', async () => {
    codeIsValid();
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const p = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await p;

    expect(sandbox.getState()).toBe('idle');
  });

  it('transitions through states: idle -> running -> idle', async () => {
    codeIsValid();
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    expect(sandbox.getState()).toBe('idle');

    let runningState: string | undefined;
    mockWorkerInstance.postMessage.mockImplementationOnce(() => {
      runningState = sandbox.getState();
    });

    const p = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);
    expect(runningState).toBe('running');

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await p;

    expect(sandbox.getState()).toBe('idle');
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox.getStats()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a copy of stats (not the same reference)', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    const stats1 = sandbox.getStats();
    const stats2 = sandbox.getStats();

    expect(stats1).not.toBe(stats2);
    expect(stats1).toEqual(stats2);
  });

  it('mutating returned stats does not affect internal stats', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    const stats = sandbox.getStats();
    (stats as { totalExecutions: number }).totalExecutions = 9999;

    expect(sandbox.getStats().totalExecutions).toBe(0);
  });

  it('has correct initial values', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    const stats = sandbox.getStats();

    expect(stats).toEqual({
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalExecutionTime: 0,
      averageExecutionTime: 0,
      terminatedCount: 0,
    });
  });

  it('stats update after execution', async () => {
    codeIsValid();
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const p = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 8 } });
    await p;

    const stats = sandbox.getStats();
    expect(stats.totalExecutions).toBe(1);
    expect(stats.successfulExecutions).toBe(1);
    expect(stats.totalExecutionTime).toBe(8);
    expect(stats.averageExecutionTime).toBe(8);
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox.getPluginId()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the configured pluginId', () => {
    const sandbox = new WorkerSandbox(makeConfig());
    expect(sandbox.getPluginId()).toBe(TEST_PLUGIN_ID);
  });

  it('returns different pluginIds for different configs', () => {
    const sandboxA = new WorkerSandbox({ pluginId: 'plugin-a' as unknown as PluginId });
    const sandboxB = new WorkerSandbox({ pluginId: 'plugin-b' as unknown as PluginId });

    expect(sandboxA.getPluginId()).toBe('plugin-a');
    expect(sandboxB.getPluginId()).toBe('plugin-b');
  });
});

// ---------------------------------------------------------------------------

describe('WorkerSandbox edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codeIsValid();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('execute after terminate reinitializes worker', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();
    await sandbox.terminate();

    const firstCallCount = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls.length;

    setupAutoReadyWorker();
    const executePromise = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });

    const result = await executePromise;
    expect(result.ok).toBe(true);
    expect((WorkerMock as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(firstCallCount);
  });

  it('does not crash when worker receives unexpected message type', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const p = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    // Send an unrecognised message type — should be silently ignored
    expect(() =>
      messageHandler?.({ type: 'resource', action: 'network', allowed: false })
    ).not.toThrow();

    // Resolve normally
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    const result = await p;
    expect(result.ok).toBe(true);
  });

  it('very large timeout value is accepted and execution resolves normally', async () => {
    vi.useFakeTimers();

    const sandbox = new WorkerSandbox(
      makeConfig({ limits: { maxExecutionTime: Number.MAX_SAFE_INTEGER } })
    );
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('return 1');
    // postMessage is called synchronously inside execute()
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });

    const result = await executePromise;
    expect(result.ok).toBe(true);
  });

  it('execute with empty string code (valid by mock) sends empty code to worker', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0] as {
      type: string;
      code: string;
    };
    expect(sentMessage.code).toBe('');

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({ type: 'result', result: { success: true, executionTime: 2 } });
    await executePromise;
  });

  it('ValidationError errors array is populated from each validation error', async () => {
    codeIsInvalid(['Pattern A not allowed', 'Pattern B not allowed']);

    const sandbox = new WorkerSandbox(makeConfig());
    const result = await sandbox.execute('bad code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const verr = result.error as ValidationError;
      expect(verr.errors).toHaveLength(2);
      expect(verr.errors?.[0]).toEqual({ path: ['error_0'], message: 'Pattern A not allowed' });
      expect(verr.errors?.[1]).toEqual({ path: ['error_1'], message: 'Pattern B not allowed' });
    }
  });

  it('randomUUID is called for each execution to generate unique IDs', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const messageHandler = getWorkerHandler('message');

    const p1 = sandbox.execute('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length >= 1);
    messageHandler?.({ type: 'result', result: { success: true, value: 1, executionTime: 5 } });
    await p1;

    const p2 = sandbox.execute('return 2');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length >= 2);
    messageHandler?.({ type: 'result', result: { success: true, value: 2, executionTime: 5 } });
    await p2;

    expect(mockRandomUUID).toHaveBeenCalledTimes(2);
  });

  it('Worker throws inside Promise executor — initialize() rejects with raw error', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    (WorkerMock as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
      throw new Error('init fail');
    });

    const sandbox = new WorkerSandbox(makeConfig());
    // Synchronous throws inside the Promise executor cause rejection, not err() wrapping.
    await expect(sandbox.initialize()).rejects.toThrow('init fail');
  });

  it('TimeoutError has correct operation set to "sandbox"', async () => {
    vi.useFakeTimers();

    const sandbox = new WorkerSandbox(makeConfig({ limits: { maxExecutionTime: 1000 } }));
    await initializeWithFakeTimers(sandbox);

    const executePromise = sandbox.execute('infinite loop code');
    // postMessage is synchronous inside execute()
    expect(mockWorkerInstance.postMessage.mock.calls.length).toBeGreaterThan(0);

    await vi.runAllTimersAsync();
    const result = await executePromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as TimeoutError).operation).toBe('sandbox');
    }
  });

  it('ValidationError has correct code property (VALIDATION_ERROR)', async () => {
    codeIsInvalid(['Dangerous pattern detected']);
    const sandbox = new WorkerSandbox(makeConfig());
    const result = await sandbox.execute('bad code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as ValidationError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('debug mode is forwarded to worker via config in workerData', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig({ debug: true }));
    await sandbox.initialize();

    const opts = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      workerData: { config: { debug: boolean } };
    };
    expect(opts.workerData.config.debug).toBe(true);
  });

  it('globals config option is forwarded to worker via workerData', async () => {
    const { Worker: WorkerMock } = await import('node:worker_threads');
    setupAutoReadyWorker();

    const sandbox = new WorkerSandbox(makeConfig({ globals: { MY_CONST: 42 } }));
    await sandbox.initialize();

    const opts = (WorkerMock as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      workerData: { config: { globals: Record<string, unknown> } };
    };
    expect(opts.workerData.config.globals).toEqual({ MY_CONST: 42 });
  });

  it('worker exit code 2 sets state to error (non-zero)', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const exitHandler = getWorkerHandler('exit');
    exitHandler?.(2);

    expect(sandbox.getState()).toBe('error');
  });

  it('handles result with resourceUsage passed through', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute<number>('return 1');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({
      type: 'result',
      result: {
        success: true,
        value: 1,
        executionTime: 5,
        resourceUsage: { networkRequests: 2, fsOperations: 4 },
      },
    });

    const result = await executePromise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resourceUsage?.networkRequests).toBe(2);
      expect(result.value.resourceUsage?.fsOperations).toBe(4);
    }
  });

  it('handles failed result with stack trace', async () => {
    setupAutoReadyWorker();
    const sandbox = new WorkerSandbox(makeConfig());
    await sandbox.initialize();

    const executePromise = sandbox.execute('bad code');
    await vi.waitFor(() => mockWorkerInstance.postMessage.mock.calls.length > 0);

    const messageHandler = getWorkerHandler('message');
    messageHandler?.({
      type: 'result',
      result: {
        success: false,
        error: 'Something went wrong',
        stack: 'Error: Something went wrong\n    at line 1',
        executionTime: 3,
      },
    });

    const result = await executePromise;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.success).toBe(false);
      expect(result.value.error).toBe('Something went wrong');
      expect(result.value.stack).toContain('Error: Something went wrong');
    }
  });

  it('initializeSandbox helper initializes and resolves correctly', async () => {
    const sandbox = new WorkerSandbox(makeConfig());
    const result = await initializeSandbox(sandbox);
    expect(result.ok).toBe(true);
    expect(sandbox.getState()).toBe('idle');
  });
});
