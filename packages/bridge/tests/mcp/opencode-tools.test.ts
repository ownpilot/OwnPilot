import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolSpawnOpenCode, type BridgeConfig } from '../../mcp/tools.ts';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const testConfig: BridgeConfig = {
  url: 'http://localhost:9090',
  apiKey: 'test-api-key',
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('toolSpawnOpenCode', () => {
  it('sends POST to /v1/opencode/chat/completions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'ocode-abc',
        model: 'opencode/minimax/MiniMax-M2.5',
        choices: [{ message: { content: 'PONG' } }],
      }),
    });
    const result = await toolSpawnOpenCode(
      { project_dir: '/tmp', content: 'Say PONG', conversation_id: 'conv-1' },
      testConfig,
    );
    expect(result.content).toBe('PONG');
    expect(result.conversation_id).toBe('conv-1');
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9090/v1/opencode/chat/completions');
    expect((opts.headers as Record<string, string>)['X-Project-Dir']).toBe('/tmp');
    expect((opts.headers as Record<string, string>)['X-Conversation-Id']).toBe('conv-1');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(
      toolSpawnOpenCode({ project_dir: '/tmp', content: 'hi' }, testConfig),
    ).rejects.toThrow('spawn_opencode error (HTTP 500)');
  });

  it('passes model to request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'x',
        model: 'opencode/minimax/MiniMax-M2.5',
        choices: [{ message: { content: 'ok' } }],
      }),
    });
    await toolSpawnOpenCode(
      { project_dir: '/tmp', content: 'hi', model: 'minimax/MiniMax-M2.5' },
      testConfig,
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe('minimax/MiniMax-M2.5');
  });

  it('uses default model when model not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'y',
        model: 'opencode/minimax/MiniMax-M2.5',
        choices: [{ message: { content: 'hello' } }],
      }),
    });
    await toolSpawnOpenCode({ project_dir: '/tmp', content: 'hi' }, testConfig);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.model).toBe('minimax/MiniMax-M2.5');
  });

  it('omits X-Conversation-Id header when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'z',
        model: 'opencode/minimax/MiniMax-M2.5',
        choices: [{ message: { content: 'hi' } }],
      }),
    });
    await toolSpawnOpenCode({ project_dir: '/tmp', content: 'hi' }, testConfig);
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['X-Conversation-Id']).toBeUndefined();
  });
});
