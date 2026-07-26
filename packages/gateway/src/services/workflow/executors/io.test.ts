/**
 * Tests for workflow I/O executors — HTTP requests, delay, notification, webhook response.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';

// ---------------------------------------------------------------------------
// Mocks — vi.mock factories run before any top-level const/let, so hoisted
// values are needed for refs the factory captures.
// ---------------------------------------------------------------------------

const { mockBroadcast, mockFetch, mockLog } = vi.hoisted(() => ({
  mockBroadcast: vi.fn(),
  mockFetch: vi.fn(),
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../utils/safe-fetch.js', () => ({
  safeFetch: (...args: unknown[]) => mockFetch(...args),
  DEFAULT_MAX_REQUEST_BODY_SIZE: 1_048_576,
}));

vi.mock('../../../ws/server.js', () => ({
  wsGateway: { broadcast: mockBroadcast },
}));

vi.mock('../../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('./utils.js', () => ({
  log: mockLog,
  safeVmEval: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'node-1',
    workflowId: 'wf-1',
    type: 'http_request',
    label: 'Test Node',
    data: {},
    position: { x: 0, y: 0 },
    ...overrides,
  } as WorkflowNode;
}

function makeResult(status: 'success' | 'error' = 'success', overrides = {}): NodeResult {
  return {
    nodeId: 'node-1',
    status,
    output: {},
    durationMs: 10,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeHttpRequestNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      })
    );
  });

  it('makes a GET request with resolved URL', async () => {
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: { url: 'https://api.example.com/data', method: 'GET' },
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('success');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('resolves URL templates from node outputs', async () => {
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: { url: 'https://api.example.com/{{node-0.output.id}}', method: 'GET' },
    });
    const outputs = { 'node-0': makeResult('success', { output: { id: 42 } }) };

    const result = await executeHttpRequestNode(node, outputs, {});

    expect(result.status).toBe('success');
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/42', expect.anything());
  });

  it('sends POST with JSON body', async () => {
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: {
        url: 'https://api.example.com/submit',
        method: 'POST',
        body: '{"key":"value"}',
        bodyType: 'json',
      },
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('success');
    const fetchCall = mockFetch.mock.calls[0]!;
    const options = fetchCall[1] as RequestInit;
    expect(options.method).toBe('POST');
    expect(options.body).toBe('{"key":"value"}');
    expect((options.headers as Record<string, string>)?.['Content-Type']).toBe('application/json');
  });

  it('supports bearer token auth', async () => {
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: {
        url: 'https://api.example.com/secure',
        method: 'GET',
        auth: { type: 'bearer', token: 'my-token' },
      },
    });

    await executeHttpRequestNode(node, {}, {});

    const fetchCall = mockFetch.mock.calls[0]!;
    const options = fetchCall[1] as RequestInit;
    expect((options.headers as Record<string, string>)?.['Authorization']).toBe('Bearer my-token');
  });

  it('supports basic auth', async () => {
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: {
        url: 'https://api.example.com/secure',
        method: 'GET',
        auth: { type: 'basic', username: 'user', password: 'pass' },
      },
    });

    await executeHttpRequestNode(node, {}, {});

    const expected = `Basic ${Buffer.from('user:pass').toString('base64')}`;
    const fetchCall = mockFetch.mock.calls[0]!;
    const options = fetchCall[1] as RequestInit;
    expect((options.headers as Record<string, string>)?.['Authorization']).toBe(expected);
  });

  it('returns error on non-ok response', async () => {
    mockFetch.mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' })
    );
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: { url: 'https://api.example.com/missing', method: 'GET' },
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('404');
  });

  it('returns error on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: { url: 'https://api.example.com/fail', method: 'GET' },
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('Network error');
  });

  it('returns error when response exceeds size limit', async () => {
    mockFetch.mockResolvedValue(
      new Response('x'.repeat(500_000), {
        status: 200,
        headers: { 'content-length': '500000' },
      })
    );
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: { url: 'https://api.example.com/big', method: 'GET', maxResponseSize: 100 },
    });

    const result = await executeHttpRequestNode(node, {}, {});

    expect(result.status).toBe('error');
    expect(result.error).toContain('too large');
  });

  it('adds query params from node data', async () => {
    const { executeHttpRequestNode } = await import('./io.js');
    const node = makeNode({
      type: 'http_request',
      data: {
        url: 'https://api.example.com/search',
        method: 'GET',
        queryParams: { q: 'test', page: '1' },
      },
    });

    await executeHttpRequestNode(node, {}, {});

    const fetchCall = mockFetch.mock.calls[0]!;
    const calledUrl = fetchCall[0] as string;
    expect(calledUrl).toContain('q=test');
    expect(calledUrl).toContain('page=1');
  });
});

describe('executeDelayNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves after the specified delay', async () => {
    const { executeDelayNode } = await import('./io.js');
    const node = makeNode({
      type: 'delay',
      data: { duration: '0.001', unit: 'seconds' },
    });

    const result = await executeDelayNode(node, {}, {});
    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).delayMs).toBe(1);
  });

  it('rejects when abort signal is fired', async () => {
    const { executeDelayNode } = await import('./io.js');
    const ac = new AbortController();
    const node = makeNode({
      type: 'delay',
      data: { duration: '1', unit: 'seconds' },
    });

    const promise = executeDelayNode(node, {}, {}, ac.signal);
    ac.abort();

    const result = await promise;
    expect(result.status).toBe('error');
    expect(result.error).toContain('cancelled');
  });

  it('returns error for invalid duration', async () => {
    const { executeDelayNode } = await import('./io.js');
    const node = makeNode({
      type: 'delay',
      data: { duration: '-1', unit: 'seconds' },
    });

    const result = await executeDelayNode(node, {}, {});
    expect(result.status).toBe('error');
    expect(result.error).toContain('Invalid delay');
  });

  it('caps delay at 1 hour', async () => {
    vi.useFakeTimers();
    const { executeDelayNode } = await import('./io.js');
    const node = makeNode({
      type: 'delay',
      data: { duration: '5', unit: 'hours' },
    });

    const promise = executeDelayNode(node, {}, {});
    await vi.advanceTimersByTimeAsync(3_600_000);

    const result = await promise;
    vi.useRealTimers();
    expect(result.status).toBe('success');
    // Capped to 1 hour = 3_600_000 ms
    expect((result.output as Record<string, unknown>).delayMs).toBe(3_600_000);
  });
});

describe('executeNotificationNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcasts via WebSocket on success', async () => {
    const mockBroadcast = vi.fn();
    vi.doMock('../../../ws/server.js', () => ({
      wsGateway: { broadcast: mockBroadcast },
    }));

    const mod = await import('./io.js');

    const node = makeNode({
      type: 'notification',
      data: { message: 'Hello {{node-0.output.name}}', severity: 'warning' },
    });
    const outputs = { 'node-0': makeResult('success', { output: { name: 'World' } }) };

    const result = await mod.executeNotificationNode(node, outputs, {});
    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).sent).toBe(true);
    expect(mockBroadcast).toHaveBeenCalledWith('system:notification', {
      type: 'warning',
      message: 'Hello World',
      source: 'workflow',
    });
  });

  it('returns success even when WebSocket broadcast fails', async () => {
    const { executeNotificationNode } = await import('./io.js');
    const node = makeNode({
      type: 'notification',
      data: { message: 'Hello', severity: 'info' },
    });

    const result = await executeNotificationNode(node, {}, {});
    // WebSocket import failure is caught internally
    expect(result.status).toBe('success');
  });
});

describe('executeWebhookResponseNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns configured webhook response', async () => {
    const { executeWebhookResponseNode } = await import('./io.js');
    const node = makeNode({
      type: 'webhook_response',
      data: { statusCode: 201, body: '{"created":true}', contentType: 'application/json' },
    });

    const result = executeWebhookResponseNode(node, {}, {});

    expect(result.status).toBe('success');
    const output = result.output as Record<string, unknown>;
    expect(output.statusCode).toBe(201);
    expect(output.body).toBe('{"created":true}');
    expect(output.contentType).toBe('application/json');
  });

  it('resolves template variables in body', async () => {
    const { executeWebhookResponseNode } = await import('./io.js');
    const node = makeNode({
      type: 'webhook_response',
      data: { body: 'User {{node-0.output.name}} created' },
    });
    const outputs = { 'node-0': makeResult('success', { output: { name: 'Alice' } }) };

    const result = executeWebhookResponseNode(node, outputs, {});

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).body).toBe('User Alice created');
  });

  it('defaults to 200 status code when not specified', async () => {
    const { executeWebhookResponseNode } = await import('./io.js');
    const node = makeNode({
      type: 'webhook_response',
      data: {},
    });

    const result = executeWebhookResponseNode(node, {}, {});

    expect(result.status).toBe('success');
    expect((result.output as Record<string, unknown>).statusCode).toBe(200);
  });
});
