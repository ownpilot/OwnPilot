/**
 * Tests for the ACP server adapter (AcpServerAgent).
 *
 * Mocks the SDK + gateway dependencies so we can drive the public Agent
 * methods directly and assert:
 *   - initialize advertises our capabilities
 *   - newSession resolves defaults, creates a chat agent, returns an ID
 *   - prompt flattens ACP content blocks, dispatches to agent.chat(),
 *     pipes streamed chunks + tool calls into sessionUpdate
 *   - cancel aborts the in-flight prompt
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';

const mockChat = vi.fn();
const mockGetOrCreate = vi.fn();
const mockResolveDefaults = vi.fn();

vi.mock('../services/agent/service.js', () => ({
  getOrCreateChatAgent: (...args: unknown[]) => mockGetOrCreate(...args),
}));

vi.mock('../services/app-settings.js', () => ({
  resolveDefaultProviderAndModel: (...args: unknown[]) => mockResolveDefaults(...args),
}));

vi.mock('../services/log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Real SDK exports remain available; only the types we use at runtime
// matter. PROTOCOL_VERSION is read by initialize().
import { AcpServerAgent, flattenContentBlocks, parseToolArguments } from './acp-server.js';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

function makeConnection(): { conn: AgentSideConnection; updates: unknown[] } {
  const updates: unknown[] = [];
  const conn = {
    sessionUpdate: vi.fn(async (u: unknown) => {
      updates.push(u);
    }),
  } as unknown as AgentSideConnection;
  return { conn, updates };
}

beforeEach(() => {
  mockChat.mockReset();
  mockGetOrCreate.mockReset();
  mockResolveDefaults.mockReset();
  mockGetOrCreate.mockResolvedValue({ chat: mockChat });
});

describe('flattenContentBlocks', () => {
  it('joins text blocks with double newlines', () => {
    expect(
      flattenContentBlocks([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ])
    ).toBe('first\n\nsecond');
  });

  it('includes resource_link as a placeholder line', () => {
    expect(
      flattenContentBlocks([
        { type: 'text', text: 'check this' },
        { type: 'resource_link', uri: 'file:///foo.txt', name: 'foo.txt' },
      ])
    ).toBe('check this\n\n[resource: file:///foo.txt]');
  });

  it('prefers embedded resource text when present', () => {
    expect(
      flattenContentBlocks([
        {
          type: 'resource',
          resource: { uri: 'file:///bar.txt', text: 'inline body', mimeType: 'text/plain' },
        },
      ])
    ).toBe('inline body');
  });
});

describe('parseToolArguments', () => {
  it('parses a JSON object', () => {
    expect(parseToolArguments('{"path":"/foo"}')).toEqual({ path: '/foo' });
  });

  it('wraps a scalar JSON value in { value }', () => {
    expect(parseToolArguments('42')).toEqual({ value: 42 });
  });

  it('wraps non-JSON in { raw }', () => {
    expect(parseToolArguments('not json')).toEqual({ raw: 'not json' });
  });

  it('returns empty object for empty input', () => {
    expect(parseToolArguments('')).toEqual({});
  });
});

describe('AcpServerAgent.initialize', () => {
  it('advertises our protocol version and capabilities', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);

    const result = await agent.initialize({ protocolVersion: PROTOCOL_VERSION });
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.agentCapabilities?.loadSession).toBe(false);
    expect(result.authMethods).toEqual([]);
  });
});

describe('AcpServerAgent.newSession', () => {
  it('throws when no default provider is configured', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    mockResolveDefaults.mockResolvedValue({ provider: null, model: null });

    await expect(agent.newSession({ cwd: '/tmp', mcpServers: [] })).rejects.toThrow(
      /No default LLM provider/
    );
  });

  it('creates a chat agent and returns a unique session id', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    mockResolveDefaults.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });

    const r1 = await agent.newSession({ cwd: '/repo', mcpServers: [] });
    const r2 = await agent.newSession({ cwd: '/repo', mcpServers: [] });

    expect(r1.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r2.sessionId).not.toBe(r1.sessionId);
    expect(mockGetOrCreate).toHaveBeenCalledWith(
      'openai',
      'gpt-4o',
      undefined,
      { path: '/repo' },
      undefined
    );
  });
});

describe('AcpServerAgent.prompt', () => {
  it('throws on unknown session id', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    await expect(
      agent.prompt({ sessionId: 'nope', prompt: [{ type: 'text', text: 'hi' }] })
    ).rejects.toThrow(/Unknown session/);
  });

  it('returns end_turn on empty prompt without invoking chat', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    mockResolveDefaults.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
    const { sessionId } = await agent.newSession({ cwd: '/r', mcpServers: [] });

    const result = await agent.prompt({ sessionId, prompt: [{ type: 'text', text: '   ' }] });
    expect(result.stopReason).toBe('end_turn');
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('streams chunks as agent_message_chunk and tool calls as tool_call updates', async () => {
    const { conn, updates } = makeConnection();
    const agent = new AcpServerAgent(conn);
    mockResolveDefaults.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
    const { sessionId } = await agent.newSession({ cwd: '/r', mcpServers: [] });

    mockChat.mockImplementation(async (_msg: string, opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as (c: { content?: string; done: boolean; id: string }) => void;
      const onToolStart = opts.onToolStart as (t: {
        id: string;
        name: string;
        arguments: string;
      }) => void;
      const onToolEnd = opts.onToolEnd as (
        t: { id: string; name: string; arguments: string },
        r: { content: string; isError: boolean; durationMs: number }
      ) => void;

      onChunk({ id: 'c1', content: 'Hello ', done: false });
      onChunk({ id: 'c2', content: 'world', done: false });
      onToolStart({ id: 't1', name: 'fs.read', arguments: '{"path":"/x"}' });
      onToolEnd(
        { id: 't1', name: 'fs.read', arguments: '{"path":"/x"}' },
        { content: 'file content', isError: false, durationMs: 5 }
      );

      return { ok: true, value: {} };
    });

    const result = await agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'do the thing' }],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(mockChat.mock.calls[0]![0]).toBe('do the thing');

    // 4 updates: 2 text chunks, 1 tool_call, 1 tool_call_update
    expect(updates).toHaveLength(4);
    const textChunks = updates.filter(
      (u): u is { update: { sessionUpdate: string; content: { text: string } } } =>
        (u as { update: { sessionUpdate: string } }).update.sessionUpdate === 'agent_message_chunk'
    );
    expect(textChunks.map((u) => u.update.content.text)).toEqual(['Hello ', 'world']);

    const toolStart = updates.find(
      (u) => (u as { update: { sessionUpdate: string } }).update.sessionUpdate === 'tool_call'
    ) as { update: { rawInput: Record<string, unknown>; status: string } };
    expect(toolStart.update.rawInput).toEqual({ path: '/x' });
    expect(toolStart.update.status).toBe('pending');

    const toolEnd = updates.find(
      (u) =>
        (u as { update: { sessionUpdate: string } }).update.sessionUpdate === 'tool_call_update'
    ) as { update: { status: string; content: Array<{ content: { text: string } }> } };
    expect(toolEnd.update.status).toBe('completed');
    expect(toolEnd.update.content[0]!.content.text).toBe('file content');
  });

  it('reports tool failure as status: failed', async () => {
    const { conn, updates } = makeConnection();
    const agent = new AcpServerAgent(conn);
    mockResolveDefaults.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
    const { sessionId } = await agent.newSession({ cwd: '/r', mcpServers: [] });

    mockChat.mockImplementation(async (_msg: string, opts: Record<string, unknown>) => {
      const onToolEnd = opts.onToolEnd as (
        t: { id: string; name: string; arguments: string },
        r: { content: string; isError: boolean; durationMs: number }
      ) => void;
      onToolEnd(
        { id: 't1', name: 'bad', arguments: '{}' },
        { content: 'boom', isError: true, durationMs: 1 }
      );
      return { ok: true, value: {} };
    });

    await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'try' }] });

    const toolEnd = updates.find(
      (u) =>
        (u as { update: { sessionUpdate: string } }).update.sessionUpdate === 'tool_call_update'
    ) as { update: { status: string } };
    expect(toolEnd.update.status).toBe('failed');
  });

  it('returns cancelled and skips chunk updates when cancel() fires mid-stream', async () => {
    const { conn, updates } = makeConnection();
    const agent = new AcpServerAgent(conn);
    mockResolveDefaults.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
    const { sessionId } = await agent.newSession({ cwd: '/r', mcpServers: [] });

    mockChat.mockImplementation(async (_msg: string, opts: Record<string, unknown>) => {
      const onChunk = opts.onChunk as (c: { content?: string; done: boolean; id: string }) => void;
      onChunk({ id: 'c1', content: 'first', done: false });
      // Caller cancels here
      await agent.cancel({ sessionId });
      onChunk({ id: 'c2', content: 'second', done: false }); // should be suppressed
      return { ok: true, value: {} };
    });

    const result = await agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'go' }],
    });

    expect(result.stopReason).toBe('cancelled');
    const textChunks = updates.filter(
      (u) =>
        (u as { update: { sessionUpdate: string } }).update.sessionUpdate === 'agent_message_chunk'
    );
    expect(textChunks).toHaveLength(1);
  });

  it('propagates agent errors as thrown errors', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    mockResolveDefaults.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
    const { sessionId } = await agent.newSession({ cwd: '/r', mcpServers: [] });

    mockChat.mockResolvedValue({ ok: false, error: new Error('provider exploded') });

    await expect(
      agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })
    ).rejects.toThrow(/Agent error/);
  });
});

describe('AcpServerAgent.cancel', () => {
  it('is a no-op when no prompt is in flight', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    mockResolveDefaults.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
    const { sessionId } = await agent.newSession({ cwd: '/r', mcpServers: [] });
    await expect(agent.cancel({ sessionId })).resolves.toBeUndefined();
  });

  it('is a no-op for unknown sessions (no throw)', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    await expect(agent.cancel({ sessionId: 'nope' })).resolves.toBeUndefined();
  });
});

describe('AcpServerAgent.authenticate / setSessionMode / loadSession', () => {
  it('authenticate returns empty (OwnPilot owns its credentials)', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    await expect(agent.authenticate({ methodId: 'whatever' })).resolves.toEqual({});
  });

  it('setSessionMode is accepted silently', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    await expect(agent.setSessionMode({ sessionId: 's', modeId: 'm' })).resolves.toEqual({});
  });

  it('loadSession throws — MVP only supports new sessions', async () => {
    const { conn } = makeConnection();
    const agent = new AcpServerAgent(conn);
    await expect(agent.loadSession({ sessionId: 's', cwd: '/r', mcpServers: [] })).rejects.toThrow(
      /loadSession not implemented/
    );
  });
});
