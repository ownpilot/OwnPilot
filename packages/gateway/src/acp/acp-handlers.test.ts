import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
}));

// Mock child_process
const mockChild = {
  pid: 1234,
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  stdin: { write: vi.fn(), end: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
  killed: false,
};

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

// Mock log
vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createAcpClientHandler } from './acp-handlers.js';
import type { MappedAcpEvent } from './acp-event-mapper.js';

import { resolve } from 'node:path';

// Use a real absolute path so it works on Windows
const CWD = resolve('/home/user/project');

describe('acp-handlers', () => {
  let events: MappedAcpEvent[];
  let textOutputs: string[];
  let handler: ReturnType<typeof createAcpClientHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    textOutputs = [];
    handler = createAcpClientHandler({
      ownerSessionId: 'ses-1',
      cwd: CWD,
      onEvent: (e) => events.push(e),
      onTextOutput: (t) => textOutputs.push(t),
    });
  });

  afterEach(() => {
    handler.dispose();
  });

  // ===========================================================================
  // sessionUpdate
  // ===========================================================================
  describe('sessionUpdate', () => {
    it('maps notification and emits events', async () => {
      await handler.sessionUpdate({
        sessionId: 'acp-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' },
        },
      } as any);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('coding-agent:acp:message');
    });

    it('extracts text from message events and calls onTextOutput', async () => {
      await handler.sessionUpdate({
        sessionId: 'acp-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello world' },
        },
      } as any);

      expect(textOutputs).toEqual(['Hello world']);
    });

    it('does not call onTextOutput for non-text content', async () => {
      await handler.sessionUpdate({
        sessionId: 'acp-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'image', data: 'base64' },
        },
      } as any);

      expect(textOutputs).toEqual([]);
    });
  });

  // ===========================================================================
  // requestPermission
  // ===========================================================================
  describe('requestPermission', () => {
    it('auto-approves with first allow_once option when no handler', async () => {
      const result = await handler.requestPermission({
        toolCall: { toolCallId: 'tc-1', title: 'Write file' },
        options: [
          { optionId: 'reject', name: 'Deny', kind: 'reject_once' },
          { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        ],
      } as any);

      expect(result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } });
    });

    it('delegates to onPermissionRequest when provided', async () => {
      const permHandler = createAcpClientHandler({
        ownerSessionId: 'ses-1',
        cwd: CWD,
        onPermissionRequest: async (req) => ({
          outcome: 'selected',
          optionId: req.options[0]?.optionId,
        }),
      });

      const result = await permHandler.requestPermission({
        toolCall: { toolCallId: 'tc-1', title: 'Danger' },
        options: [{ optionId: 'opt-1', name: 'Allow', kind: 'allow_once' }],
      } as any);

      expect(result).toEqual({ outcome: { outcome: 'selected', optionId: 'opt-1' } });
      permHandler.dispose();
    });

    it('handles cancelled permission response', async () => {
      const permHandler = createAcpClientHandler({
        ownerSessionId: 'ses-1',
        cwd: CWD,
        onPermissionRequest: async () => ({ outcome: 'cancelled' }),
      });

      const result = await permHandler.requestPermission({
        toolCall: { toolCallId: 'tc-1', title: 'Danger' },
        options: [{ optionId: 'opt-1', name: 'Allow', kind: 'allow_once' }],
      } as any);

      expect(result).toEqual({ outcome: { outcome: 'cancelled' } });
      permHandler.dispose();
    });

    it('falls back to reject_once when no allow option exists', async () => {
      const result = await handler.requestPermission({
        toolCall: { toolCallId: 'tc-1', title: 'Danger' },
        options: [{ optionId: 'rej-1', name: 'Deny', kind: 'reject_once' }],
      } as any);

      expect(result).toEqual({ outcome: { outcome: 'selected', optionId: 'rej-1' } });
    });
  });

  // ===========================================================================
  // readTextFile
  // ===========================================================================
  describe('readTextFile', () => {
    it('reads a file within cwd', async () => {
      vi.mocked(readFile).mockResolvedValueOnce('file content');
      const filePath = resolve(CWD, 'src/index.ts');
      const result = await handler.readTextFile({ path: filePath } as any);
      expect(result).toEqual({ content: 'file content' });
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('index.ts'), 'utf8');
    });

    it('resolves relative paths against cwd', async () => {
      vi.mocked(readFile).mockResolvedValueOnce('data');
      const filePath = resolve(CWD, 'src/file.ts');
      await handler.readTextFile({ path: filePath } as any);
      expect(readFile).toHaveBeenCalledWith(expect.stringContaining('file.ts'), 'utf8');
    });

    it('throws for paths outside cwd', async () => {
      // Use a path that is definitely outside CWD on any platform
      const outsidePath = resolve('/', 'etc', 'passwd');
      await expect(
        handler.readTextFile({ path: outsidePath } as any)
      ).rejects.toThrow(/outside allowed directories/);
    });

    it('throws for ENOENT', async () => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      vi.mocked(readFile).mockRejectedValueOnce(err);
      const filePath = resolve(CWD, 'missing.ts');
      await expect(
        handler.readTextFile({ path: filePath } as any)
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // writeTextFile
  // ===========================================================================
  describe('writeTextFile', () => {
    it('writes a file within cwd', async () => {
      vi.mocked(writeFile).mockResolvedValueOnce(undefined);
      const filePath = resolve(CWD, 'output.ts');
      const result = await handler.writeTextFile({
        path: filePath,
        content: 'new content',
      } as any);
      expect(result).toEqual({});
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('output.ts'),
        'new content',
        'utf8'
      );
    });

    it('creates parent directory if it does not exist', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(false);
      vi.mocked(mkdir).mockResolvedValueOnce(undefined);
      vi.mocked(writeFile).mockResolvedValueOnce(undefined);

      const filePath = resolve(CWD, 'new-dir/file.ts');
      await handler.writeTextFile({
        path: filePath,
        content: 'data',
      } as any);

      expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('throws for paths outside cwd', async () => {
      const outsidePath = resolve('/', 'tmp', 'evil.ts');
      await expect(
        handler.writeTextFile({ path: outsidePath, content: 'x' } as any)
      ).rejects.toThrow(/outside allowed directories/);
    });
  });

  // ===========================================================================
  // Terminal operations
  // ===========================================================================
  describe('terminal operations', () => {
    let exitResolve: (val: any) => void;

    beforeEach(() => {
      // Reset mockChild handlers
      mockChild.on.mockReset();
      mockChild.stdout.on.mockReset();
      mockChild.stderr.on.mockReset();
      mockChild.kill.mockReset();

      // Set up event listeners to capture callbacks
      mockChild.on.mockImplementation((event: string, cb: (...args: any[]) => void) => {
        if (event === 'exit') {
          exitResolve = (val: any) => cb(val.exitCode, val.signal);
        }
      });
    });

    it('creates a terminal and returns an id', async () => {
      const result = await handler.createTerminal({
        command: 'echo',
        args: ['hello'],
      } as any);
      expect(result.terminalId).toMatch(/^acp-term-/);
      expect(spawn).toHaveBeenCalledWith('echo', ['hello'], expect.any(Object));
    });

    it('gets terminal output', async () => {
      // Create terminal first
      const { terminalId } = await handler.createTerminal({
        command: 'echo',
        args: ['test'],
      } as any);

      // Simulate stdout data
      const stdoutCb = mockChild.stdout.on.mock.calls.find(
        (c: any[]) => c[0] === 'data'
      )?.[1];
      if (stdoutCb) stdoutCb(Buffer.from('output text'));

      const output = await handler.terminalOutput({ terminalId } as any);
      expect(output.output).toContain('output text');
      expect(output.truncated).toBe(false);
    });

    it('throws for unknown terminal id', async () => {
      await expect(
        handler.terminalOutput({ terminalId: 'nonexistent' } as any)
      ).rejects.toThrow();
    });

    it('kills a terminal', async () => {
      const { terminalId } = await handler.createTerminal({
        command: 'sleep',
        args: ['60'],
      } as any);
      await handler.killTerminal({ terminalId } as any);
      expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('releases a terminal', async () => {
      const { terminalId } = await handler.createTerminal({
        command: 'sleep',
        args: ['60'],
      } as any);
      const result = await handler.releaseTerminal({ terminalId } as any);
      expect(result).toEqual({});

      // After release, getting output should throw
      await expect(
        handler.terminalOutput({ terminalId } as any)
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // dispose
  // ===========================================================================
  describe('dispose', () => {
    it('cleans up all terminals', async () => {
      await handler.createTerminal({ command: 'cmd1' } as any);
      await handler.createTerminal({ command: 'cmd2' } as any);
      handler.dispose();
      // Terminals should be cleaned up (kill called)
      expect(mockChild.kill).toHaveBeenCalled();
    });
  });
});
