/**
 * ACP-serve CLI command tests.
 *
 * Drives `startAcpServe` end-to-end with mocked stdio + a mocked
 * `runAcpServer` so we can assert:
 *   - `initializeAll` and `loadApiKeysToEnvironment` are awaited
 *     before any frames are processed
 *   - the resulting Stream wraps stdin/stdout via `ndJsonStream`
 *   - the function resolves on peer disconnect (stdin 'end')
 *   - the readyMessage hits stderr (NOT stdout — stdout is the
 *     JSON-RPC channel and any noise there would corrupt the protocol)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockRunAcpServer = vi.hoisted(() =>
  vi.fn(() => ({
    done: vi.fn(() => new Promise<void>(() => {})), // never resolves on its own
  }))
);
const mockNdJsonStream = vi.hoisted(() => vi.fn(() => ({ readable: {}, writable: {} })));
const mockLoadApiKeys = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@agentclientprotocol/sdk', () => ({
  ndJsonStream: (...args: unknown[]) => mockNdJsonStream(...args),
}));

vi.mock('@ownpilot/gateway', () => ({
  runAcpServer: (...args: unknown[]) => mockRunAcpServer(...args),
  loadApiKeysToEnvironment: (...args: unknown[]) => mockLoadApiKeys(...args),
}));

vi.mock('node:stream', () => ({
  Readable: { toWeb: vi.fn(() => ({ tag: 'web-readable' })) },
  Writable: { toWeb: vi.fn(() => ({ tag: 'web-writable' })) },
}));

import { startAcpServe } from './acp.js';

beforeEach(() => {
  mockRunAcpServer.mockClear();
  mockNdJsonStream.mockClear();
  mockLoadApiKeys.mockClear();
});

describe('startAcpServe', () => {
  it('invokes initializer + key loader before binding the server', async () => {
    const initOrder: string[] = [];
    const initializer = vi.fn(async () => {
      initOrder.push('init');
    });
    mockLoadApiKeys.mockImplementation(async () => {
      initOrder.push('loadKeys');
    });
    mockNdJsonStream.mockImplementation(() => {
      initOrder.push('ndJsonStream');
      return { readable: {}, writable: {} };
    });
    mockRunAcpServer.mockImplementation(() => {
      initOrder.push('runAcpServer');
      return { done: vi.fn(() => new Promise<void>(() => {})) };
    });

    // Simulate stdin disconnect on next tick to let the promise resolve.
    const stdinStub = new EventEmitter();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: stdinStub,
      configurable: true,
    });
    setImmediate(() => stdinStub.emit('end'));

    try {
      await startAcpServe(initializer);
    } finally {
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
    }

    expect(initOrder).toEqual(['init', 'loadKeys', 'ndJsonStream', 'runAcpServer']);
    expect(initializer).toHaveBeenCalledTimes(1);
  });

  it('writes the readyMessage to stderr (never stdout)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const stdinStub = new EventEmitter();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: stdinStub,
      configurable: true,
    });
    setImmediate(() => stdinStub.emit('end'));

    try {
      await startAcpServe(async () => undefined, { readyMessage: 'acp ready' });
    } finally {
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
    }

    expect(stderrSpy).toHaveBeenCalledWith('acp ready\n');
    expect(stdoutSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('resolves when stdin closes (not just on end)', async () => {
    const stdinStub = new EventEmitter();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: stdinStub,
      configurable: true,
    });
    setImmediate(() => stdinStub.emit('close'));

    try {
      await startAcpServe(async () => undefined);
    } finally {
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
    }
  });

  it('passes the ndJsonStream output through to runAcpServer', async () => {
    const stdinStub = new EventEmitter();
    const originalStdin = process.stdin;
    Object.defineProperty(process, 'stdin', {
      value: stdinStub,
      configurable: true,
    });
    setImmediate(() => stdinStub.emit('end'));

    try {
      await startAcpServe(async () => undefined);
    } finally {
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        configurable: true,
      });
    }

    expect(mockNdJsonStream).toHaveBeenCalledTimes(1);
    expect(mockRunAcpServer).toHaveBeenCalledTimes(1);
    // ndJsonStream receives (output, input)
    const [outArg, inArg] = mockNdJsonStream.mock.calls[0]!;
    expect((outArg as { tag: string }).tag).toBe('web-writable');
    expect((inArg as { tag: string }).tag).toBe('web-readable');
  });
});
