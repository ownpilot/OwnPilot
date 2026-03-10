import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process
const mockStdin = { write: vi.fn(), end: vi.fn() };
const mockStdout = { on: vi.fn(), pipe: vi.fn() };
const mockStderr = { on: vi.fn() };
const mockProcess = {
  pid: 9999,
  stdin: mockStdin,
  stdout: mockStdout,
  stderr: mockStderr,
  on: vi.fn(),
  kill: vi.fn(),
  killed: false,
};

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockProcess),
}));

// Mock stream conversion
vi.mock('node:stream', () => ({
  Readable: {
    toWeb: vi.fn(() => new ReadableStream()),
  },
  Writable: {
    toWeb: vi.fn(() => new WritableStream()),
  },
}));

// Mock ACP SDK
const mockAgent = {
  initialize: vi.fn().mockResolvedValue({
    protocolVersion: 1,
    agentInfo: { name: 'test-agent', version: '1.0.0', title: 'Test Agent' },
    authMethods: [],
  }),
  newSession: vi.fn().mockResolvedValue({
    sessionId: 'acp-ses-1',
    availableModes: [{ id: 'code' }, { id: 'ask' }],
    currentMode: { id: 'code' },
    configOptions: [],
  }),
  prompt: vi.fn().mockResolvedValue({
    stopReason: 'end_turn',
  }),
  cancel: vi.fn().mockResolvedValue({}),
  setSessionMode: vi.fn().mockResolvedValue({}),
  authenticate: vi.fn().mockResolvedValue({}),
};

const mockConnection = {
  closed: new Promise(() => {}), // Never resolves
};

vi.mock('@agentclientprotocol/sdk', () => ({
  ClientSideConnection: vi.fn().mockImplementation(function (factory: any, _stream: any) {
    // Call factory to set up agent reference
    factory(mockAgent);
    return mockConnection;
  }),
  ndJsonStream: vi.fn(() => ({})),
  PROTOCOL_VERSION: 1,
}));

// Mock handlers
vi.mock('./acp-handlers.js', () => ({
  createAcpClientHandler: vi.fn(() => ({
    sessionUpdate: vi.fn(),
    requestPermission: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    createTerminal: vi.fn(),
    terminalOutput: vi.fn(),
    waitForTerminalExit: vi.fn(),
    killTerminal: vi.fn(),
    releaseTerminal: vi.fn(),
    dispose: vi.fn(),
  })),
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

import { spawn } from 'node:child_process';
import { AcpClient } from './acp-client.js';
import type { AcpClientOptions } from './types.js';

const defaultOptions: AcpClientOptions = {
  binary: 'gemini',
  args: ['--experimental-acp'],
  cwd: '/home/user/project',
  env: { PATH: '/usr/bin' },
  ownerSessionId: 'ses-owner-1',
  clientName: 'ownpilot-test',
  clientVersion: '1.0.0',
};

describe('AcpClient', () => {
  let client: AcpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.killed = false;
    mockProcess.kill.mockReset();
    client = new AcpClient(defaultOptions);
  });

  // ===========================================================================
  // Constructor & properties
  // ===========================================================================
  describe('constructor', () => {
    it('initializes with connecting state', () => {
      expect(client.connectionState).toBe('connecting');
      expect(client.currentSession).toBeNull();
      expect(client.currentToolCalls).toEqual([]);
      expect(client.plan).toBeNull();
      expect(client.output).toBe('');
      expect(client.pid).toBeUndefined();
    });
  });

  // ===========================================================================
  // connect
  // ===========================================================================
  describe('connect', () => {
    it('spawns the agent process', async () => {
      await client.connect();
      expect(spawn).toHaveBeenCalledWith('gemini', ['--experimental-acp'], {
        cwd: '/home/user/project',
        env: { PATH: '/usr/bin' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });

    it('transitions to ready state after initialization', async () => {
      await client.connect();
      expect(client.connectionState).toBe('ready');
    });

    it('stores agent info from initialization', async () => {
      await client.connect();
      expect(client.currentSession?.agentInfo).toEqual({
        name: 'test-agent',
        version: '1.0.0',
        title: 'Test Agent',
      });
    });

    it('calls onStateChange callback', async () => {
      const stateChanges: string[] = [];
      const optionsWithCallback = {
        ...defaultOptions,
        onStateChange: (s: any) => stateChanges.push(s),
      };
      client = new AcpClient(optionsWithCallback);
      await client.connect();
      // 'connecting' is initial state — setState skips if same, so it won't fire
      expect(stateChanges).toContain('initializing');
      expect(stateChanges).toContain('ready');
    });

    it('handles authentication when authMethods are returned', async () => {
      mockAgent.initialize.mockResolvedValueOnce({
        protocolVersion: 1,
        agentInfo: { name: 'test', version: '1.0', title: 'T' },
        authMethods: [{ id: 'oauth', type: 'terminal' }],
      });

      await client.connect();
      expect(mockAgent.authenticate).toHaveBeenCalledWith({ methodId: 'oauth' });
    });
  });

  // ===========================================================================
  // createSession
  // ===========================================================================
  describe('createSession', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('creates a session and returns session ID', async () => {
      const sessionId = await client.createSession();
      expect(sessionId).toBe('acp-ses-1');
      expect(mockAgent.newSession).toHaveBeenCalledWith({
        cwd: '/home/user/project',
        mcpServers: undefined,
      });
    });

    it('passes MCP servers to agent', async () => {
      await client.createSession({
        mcpServers: [
          { name: 'ownpilot', transport: 'http', url: 'http://localhost:3000/mcp' },
        ],
      });

      const callArgs = mockAgent.newSession.mock.calls[0][0];
      expect(callArgs.mcpServers).toHaveLength(1);
      expect(callArgs.mcpServers[0]).toEqual(
        expect.objectContaining({ type: 'http', name: 'ownpilot', url: 'http://localhost:3000/mcp' })
      );
    });

    it('stores session with available modes', async () => {
      await client.createSession();
      expect(client.currentSession?.availableModes).toEqual([{ id: 'code' }, { id: 'ask' }]);
      expect(client.currentSession?.currentMode).toBe('code');
    });

    it('throws if not connected', async () => {
      const newClient = new AcpClient(defaultOptions);
      await expect(newClient.createSession()).rejects.toThrow(/Not connected/);
    });
  });

  // ===========================================================================
  // prompt
  // ===========================================================================
  describe('prompt', () => {
    beforeEach(async () => {
      await client.connect();
      await client.createSession();
    });

    it('sends a prompt and returns result', async () => {
      const result = await client.prompt('Fix the tests');
      expect(result.stopReason).toBe('end_turn');
      expect(result.toolCalls).toEqual([]);
      expect(result.plan).toBeNull();
      expect(mockAgent.prompt).toHaveBeenCalledWith({
        sessionId: 'acp-ses-1',
        prompt: [{ type: 'text', text: 'Fix the tests' }],
      });
    });

    it('includes file context as resource_link blocks', async () => {
      await client.prompt('Review these files', {
        files: ['/src/index.ts', '/src/utils.ts'],
      });

      const promptArgs = mockAgent.prompt.mock.calls[0][0];
      expect(promptArgs.prompt).toHaveLength(3); // text + 2 resource_links
      expect(promptArgs.prompt[1]).toEqual({
        type: 'resource_link',
        uri: 'file:///src/index.ts',
        name: 'index.ts',
      });
    });

    it('transitions state to prompting then back to ready', async () => {
      const states: string[] = [];
      const optionsWithCallback = {
        ...defaultOptions,
        onStateChange: (s: any) => states.push(s),
      };
      const c = new AcpClient(optionsWithCallback);
      await c.connect();
      await c.createSession();
      states.length = 0; // Reset

      await c.prompt('test');
      expect(states).toContain('prompting');
      expect(states[states.length - 1]).toBe('ready');
    });

    it('throws if no session exists', async () => {
      const newClient = new AcpClient(defaultOptions);
      await expect(newClient.prompt('test')).rejects.toThrow(/No active session/);
    });
  });

  // ===========================================================================
  // cancel
  // ===========================================================================
  describe('cancel', () => {
    it('calls agent.cancel with session ID', async () => {
      await client.connect();
      await client.createSession();
      await client.cancel();
      expect(mockAgent.cancel).toHaveBeenCalledWith({ sessionId: 'acp-ses-1' });
    });

    it('does nothing if no session', async () => {
      await client.cancel(); // Should not throw
    });
  });

  // ===========================================================================
  // setMode
  // ===========================================================================
  describe('setMode', () => {
    it('calls agent.setSessionMode', async () => {
      await client.connect();
      await client.createSession();
      await client.setMode('ask');
      expect(mockAgent.setSessionMode).toHaveBeenCalledWith({
        sessionId: 'acp-ses-1',
        modeId: 'ask',
      });
    });
  });

  // ===========================================================================
  // close
  // ===========================================================================
  describe('close', () => {
    it('kills the process and cleans up', async () => {
      await client.connect();
      await client.close();
      expect(client.connectionState).toBe('closed');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(client.currentSession).toBeNull();
    });

    it('is safe to call multiple times', async () => {
      await client.connect();
      await client.close();
      await client.close();
      expect(client.connectionState).toBe('closed');
    });
  });

  // ===========================================================================
  // toAcpMcpServer (tested via createSession)
  // ===========================================================================
  describe('MCP server conversion', () => {
    beforeEach(async () => {
      await client.connect();
    });

    it('converts stdio transport', async () => {
      await client.createSession({
        mcpServers: [
          { name: 'local', transport: 'stdio', command: '/usr/bin/mcp', args: ['--port', '3000'] },
        ],
      });

      const servers = mockAgent.newSession.mock.calls[0][0].mcpServers;
      expect(servers[0]).toEqual({
        name: 'local',
        command: '/usr/bin/mcp',
        args: ['--port', '3000'],
        env: [],
      });
    });

    it('converts http transport with headers', async () => {
      await client.createSession({
        mcpServers: [
          {
            name: 'remote',
            transport: 'http',
            url: 'https://api.example.com/mcp',
            headers: { Authorization: 'Bearer tok' },
          },
        ],
      });

      const servers = mockAgent.newSession.mock.calls[0][0].mcpServers;
      expect(servers[0]).toEqual({
        type: 'http',
        name: 'remote',
        url: 'https://api.example.com/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer tok' }],
      });
    });

    it('converts sse transport', async () => {
      await client.createSession({
        mcpServers: [
          { name: 'sse-server', transport: 'sse', url: 'https://api.example.com/sse' },
        ],
      });

      const servers = mockAgent.newSession.mock.calls[0][0].mcpServers;
      expect(servers[0]).toEqual({
        type: 'sse',
        name: 'sse-server',
        url: 'https://api.example.com/sse',
        headers: [],
      });
    });
  });
});
