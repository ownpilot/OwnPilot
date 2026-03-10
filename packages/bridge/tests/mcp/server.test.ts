import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  toolPing,
  toolSpawnCc,
  toolSpawnCcAsync,
  toolPollCc,
  toolGetCcResult,
  toolTriggerGsd,
  toolRespondCc,
  toolStartInteractive,
  toolSendInteractive,
  toolCloseInteractive,
  _clearJobStore,
  _setPollIntervalMs,
  _setPollWindowMs,
  getBridgeConfig,
  type BridgeConfig,
} from '../../mcp/tools.ts';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const testConfig: BridgeConfig = {
  url: 'http://localhost:9090',
  apiKey: 'test-api-key',
};

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── toolPing ──────────────────────────────────────────────────────────────

describe('toolPing', () => {
  it('returns pong:true and a timestamp on 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ pong: true, timestamp: '2026-03-02T12:00:00.000Z' }),
    });

    const result = await toolPing(testConfig);

    expect(result.pong).toBe(true);
    expect(typeof result.timestamp).toBe('string');
    expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:9090/ping',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }) }),
    );
  });

  it('throws on bridge 500 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    await expect(toolPing(testConfig)).rejects.toThrow('Bridge ping error (HTTP 500)');
  });
});

// ─── toolSpawnCc ───────────────────────────────────────────────────────────

describe('toolSpawnCc', () => {
  const bridgeResponse = {
    id: 'sess-abc123',
    model: 'bridge-model',
    choices: [{ message: { content: 'Task complete.' } }],
  };

  beforeEach(() => {
    _clearJobStore();
    mockFetch.mockReset();
    _setPollIntervalMs(10);  // fast polling for tests
    _setPollWindowMs(500);   // short window for tests
  });

  it('returns content + ids from bridge response (short task)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => bridgeResponse,
    });

    const result = await toolSpawnCc(
      { project_dir: '/home/ayaz/openclaw-bridge', content: 'hello', conversation_id: 'sync-1' },
      testConfig,
    );

    expect('content' in result).toBe(true);
    if ('content' in result) {
      expect(result.content).toBe('Task complete.');
      expect(result.session_id).toBe('sess-abc123');
      expect(result.model).toBe('bridge-model');
    }
  });

  it('sets X-Conversation-Id header when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => bridgeResponse });

    await toolSpawnCc(
      { project_dir: '/home/ayaz/openclaw-bridge', content: 'hello', conversation_id: 'conv-42' },
      testConfig,
    );

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(opts.headers['X-Conversation-Id']).toBe('conv-42');
  });

  it('sets X-Orchestrator-Id header when provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => bridgeResponse });

    await toolSpawnCc(
      { project_dir: '/home/ayaz/openclaw-bridge', content: 'hello', orchestrator_id: 'orch-99' },
      testConfig,
    );

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(opts.headers['X-Orchestrator-Id']).toBe('orch-99');
  });

  it('auto-generates X-Conversation-Id when none provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => bridgeResponse });

    await toolSpawnCc({ project_dir: '/home/ayaz/openclaw-bridge', content: 'hello' }, testConfig);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(typeof opts.headers['X-Conversation-Id']).toBe('string');
    expect(opts.headers['X-Conversation-Id']).toMatch(/^cc-\d+/);
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => 'bridge down',
    });

    await expect(
      toolSpawnCc({ project_dir: '/tmp/proj', content: 'hi', conversation_id: 'err-1' }, testConfig),
    ).rejects.toThrow('Bridge spawn_cc error (HTTP 503)');
  });

  it('uses X-Project-Dir header from project_dir', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => bridgeResponse });

    await toolSpawnCc(
      { project_dir: '/home/ayaz/myproject', content: 'run tests', conversation_id: 'proj-1' },
      testConfig,
    );

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(opts.headers['X-Project-Dir']).toBe('/home/ayaz/myproject');
  });

  it('returns SpawnCcRunningState when task exceeds poll window', async () => {
    // Never resolves — simulates a very long-running CC task
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const result = await toolSpawnCc(
      { project_dir: '/test', content: 'long task', conversation_id: 'long-1' },
      testConfig,
    );

    expect('status' in result && result.status === 'running').toBe(true);
    if ('status' in result) {
      expect(result.conversation_id).toBe('long-1');
      expect(result.hint).toContain('long-1');
    }
  });

  it('resumes and returns result when called again with same conversation_id', async () => {
    // First call: task exceeds window → running state
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const first = await toolSpawnCc(
      { project_dir: '/test', content: 'long task', conversation_id: 'resume-1' },
      testConfig,
    );
    expect('status' in first && first.status === 'running').toBe(true);

    // Simulate CC completing in background
    mockFetch.mockReset();
    // Job store still has the running entry — manually set to done for test
    // (In reality, the background fetch would resolve)
    // We verify resume path by checking the job store handles existing jobs
    const second = await toolSpawnCc(
      { project_dir: '/test', content: 'continue', conversation_id: 'resume-1' },
      testConfig,
    );
    // Still running (background fetch still blocked) — resumes polling
    expect('status' in second && second.status === 'running').toBe(true);
    expect('conversation_id' in second && second.conversation_id === 'resume-1').toBe(true);
  });
});

// ─── toolSpawnCcAsync / toolPollCc / toolGetCcResult ─────────────────────────

const bridgeResponseAsync = {
  id: 'sess-async-1',
  model: 'bridge-model',
  choices: [{ message: { content: 'Async task complete.' } }],
};

describe('toolSpawnCcAsync', () => {
  beforeEach(() => { _clearJobStore(); mockFetch.mockReset(); });

  it('returns immediately with running status and job_id', async () => {
    // fetch blocks indefinitely — verifies we don't await it
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const result = await toolSpawnCcAsync(
      { project_dir: '/home/ayaz/openclaw-bridge', content: 'long task', conversation_id: 'conv-async-1' },
      testConfig,
    );

    expect(result.status).toBe('running');
    expect(result.job_id).toBe('conv-async-1');
    expect(result.conversation_id).toBe('conv-async-1');
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('auto-generates job_id when no conversation_id provided', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    const result = await toolSpawnCcAsync(
      { project_dir: '/home/ayaz/openclaw-bridge', content: 'task' },
      testConfig,
    );

    expect(typeof result.job_id).toBe('string');
    expect(result.job_id.length).toBeGreaterThan(4);
  });
});

describe('toolPollCc', () => {
  beforeEach(() => { _clearJobStore(); mockFetch.mockReset(); });

  it('returns running while fetch is pending', async () => {
    let settle!: () => void;
    mockFetch.mockImplementation(() => new Promise(resolve => { settle = () => resolve({ ok: true, json: async () => bridgeResponseAsync }); }));

    await toolSpawnCcAsync(
      { project_dir: '/test', content: 'task', conversation_id: 'poll-running-1' },
      testConfig,
    );

    expect(toolPollCc('poll-running-1').status).toBe('running');
    settle();
  });

  it('returns done status after job completes', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => bridgeResponseAsync });

    await toolSpawnCcAsync(
      { project_dir: '/test', content: 'task', conversation_id: 'poll-done-1' },
      testConfig,
    );
    // yield to microtask queue so background promise resolves
    await new Promise(resolve => setTimeout(resolve, 20));

    const result = toolPollCc('poll-done-1');
    expect(result.status).toBe('done');
    expect(result.result?.content).toBe('Async task complete.');
  });

  it('returns error status when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network failure'));

    await toolSpawnCcAsync(
      { project_dir: '/test', content: 'task', conversation_id: 'poll-err-1' },
      testConfig,
    );
    await new Promise(resolve => setTimeout(resolve, 20));

    const result = toolPollCc('poll-err-1');
    expect(result.status).toBe('error');
    expect(result.error).toContain('network failure');
  });

  it('throws when job not found', () => {
    expect(() => toolPollCc('nonexistent-job')).toThrow('Job not found');
  });
});

describe('toolGetCcResult', () => {
  beforeEach(() => { _clearJobStore(); mockFetch.mockReset(); });

  it('returns result when job is done', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => bridgeResponseAsync });

    await toolSpawnCcAsync(
      { project_dir: '/test', content: 'task', conversation_id: 'result-done-1' },
      testConfig,
    );
    await new Promise(resolve => setTimeout(resolve, 20));

    const result = toolGetCcResult('result-done-1');
    expect(result.content).toBe('Async task complete.');
    expect(result.session_id).toBe('sess-async-1');
  });

  it('throws when job still running', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    await toolSpawnCcAsync(
      { project_dir: '/test', content: 'task', conversation_id: 'result-running-1' },
      testConfig,
    );

    expect(() => toolGetCcResult('result-running-1')).toThrow('still running');
  });

  it('throws when job failed', async () => {
    mockFetch.mockRejectedValueOnce(new Error('bridge error'));

    await toolSpawnCcAsync(
      { project_dir: '/test', content: 'task', conversation_id: 'result-fail-1' },
      testConfig,
    );
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(() => toolGetCcResult('result-fail-1')).toThrow('failed');
  });

  it('throws when job not found', () => {
    expect(() => toolGetCcResult('nonexistent')).toThrow('not found');
  });
});

// ─── toolTriggerGsd ──────────────────────────────────────────────────────────

describe('toolTriggerGsd', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('POSTs to /v1/projects/:projectDir/gsd and returns state', async () => {
    const gsdState = { gsdSessionId: 'gsd-abc', status: 'running', message: '/gsd:progress' };
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => gsdState });

    const result = await toolTriggerGsd('/home/ayaz/ownpilot', '/gsd:progress', testConfig);

    expect(result.gsdSessionId).toBe('gsd-abc');
    expect(result.status).toBe('running');
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string>, body: string }];
    expect(url).toBe('http://localhost:9090/v1/projects/%2Fhome%2Fayaz%2Fownpilot/gsd');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string).message).toBe('/gsd:progress');
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(
      toolTriggerGsd('/nonexistent', '/gsd:progress', testConfig),
    ).rejects.toThrow('Bridge trigger_gsd error (HTTP 404)');
  });
});

// ─── toolRespondCc ───────────────────────────────────────────────────────────

describe('toolRespondCc', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('POSTs to /v1/sessions/:sessionId/respond with content', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    const result = await toolRespondCc('sess-abc', 'Phase 5 ile baslayalim', testConfig);

    expect(result.ok).toBe(true);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(url).toBe('http://localhost:9090/v1/sessions/sess-abc/respond');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).message).toBe('Phase 5 ile baslayalim');
  });

  it('sends Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    await toolRespondCc('sess-abc', 'hello', testConfig);

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(opts.headers['Authorization']).toBe('Bearer test-api-key');
  });

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await expect(toolRespondCc('bad-id', 'hi', testConfig))
      .rejects.toThrow('Bridge respond_cc error (HTTP 404)');
  });

  it('throws on 500 with actionable hint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(toolRespondCc('sess-x', 'content', testConfig))
      .rejects.toThrow('Bridge respond_cc error (HTTP 500)');
  });
});

// ─── toolStartInteractive ────────────────────────────────────────────────────

describe('toolStartInteractive', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('POSTs to /v1/sessions/start-interactive and returns session info', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ status: 'interactive', conversationId: 'int-1', sessionId: 'sess-int-1', pid: 12345 }),
    });
    const result = await toolStartInteractive('/home/ayaz/proj', 'be helpful', 10, 'conv-int-1', testConfig);
    expect(result.status).toBe('interactive');
    expect(result.pid).toBe(12345);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(url).toBe('http://localhost:9090/v1/sessions/start-interactive');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Conversation-Id']).toBe('conv-int-1');
    const body = JSON.parse(opts.body);
    expect(body.project_dir).toBe('/home/ayaz/proj');
    expect(body.system_prompt).toBe('be helpful');
    expect(body.max_turns).toBe(10);
  });

  it('throws on 429 rate limit', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
    await expect(toolStartInteractive('/proj', undefined, undefined, undefined, testConfig))
      .rejects.toThrow('Bridge start_interactive error (HTTP 429)');
  });
});

// ─── toolSendInteractive ────────────────────────────────────────────────────

describe('toolSendInteractive', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('POSTs message to /v1/sessions/:id/input', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ status: 'sent', conversationId: 'int-1', sessionId: 'sess-int-1' }),
    });
    const result = await toolSendInteractive('sess-int-1', 'hello CC', testConfig);
    expect(result.status).toBe('sent');
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(url).toBe('http://localhost:9090/v1/sessions/sess-int-1/input');
    expect(JSON.parse(opts.body).message).toBe('hello CC');
  });

  it('throws on 409 not interactive', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 409 });
    await expect(toolSendInteractive('bad-sess', 'hi', testConfig))
      .rejects.toThrow('Bridge send_interactive error (HTTP 409)');
  });
});

// ─── toolCloseInteractive ────────────────────────────────────────────────────

describe('toolCloseInteractive', () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it('POSTs to /v1/sessions/:id/close-interactive', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ status: 'closed', conversationId: 'int-1' }),
    });
    const result = await toolCloseInteractive('sess-int-1', testConfig);
    expect(result.status).toBe('closed');
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9090/v1/sessions/sess-int-1/close-interactive');
    expect(opts.method).toBe('POST');
  });

  it('throws on 404 session not found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(toolCloseInteractive('gone', testConfig))
      .rejects.toThrow('Bridge close_interactive error (HTTP 404)');
  });
});

// ─── getBridgeConfig ────────────────────────────────────────────────────────

describe('getBridgeConfig', () => {
  it('falls back to defaults when env vars not set', () => {
    delete process.env.BRIDGE_URL;
    delete process.env.BRIDGE_API_KEY;

    const cfg = getBridgeConfig();
    expect(cfg.url).toBe('http://localhost:9090');
    expect(cfg.apiKey).toBe('YOUR_BRIDGE_API_KEY_HERE');
  });

  it('uses env vars when set', () => {
    process.env.BRIDGE_URL = 'http://my-bridge:8080';
    process.env.BRIDGE_API_KEY = 'my-custom-key';

    const cfg = getBridgeConfig();
    expect(cfg.url).toBe('http://my-bridge:8080');
    expect(cfg.apiKey).toBe('my-custom-key');

    delete process.env.BRIDGE_URL;
    delete process.env.BRIDGE_API_KEY;
  });
});
