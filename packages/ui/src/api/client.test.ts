/**
 * API Client Tests
 *
 * Tests envelope unwrapping, error normalization, query serialization,
 * network error handling, and streaming.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiClient, ApiError } from './client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function okEnvelope<T>(data: T) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data,
      meta: { requestId: 'req-1', timestamp: new Date().toISOString() },
    }),
  } as unknown as Response;
}

function errorEnvelope(status: number, code: string, message: string) {
  return {
    ok: false,
    status,
    json: async () => ({
      success: false,
      error: { code, message },
      meta: { requestId: 'req-2', timestamp: '' },
    }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('apiClient.get', () => {
  it('returns unwrapped data on success', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({ items: [1, 2, 3] }));

    const result = await apiClient.get<{ items: number[] }>('/tasks');

    expect(result).toEqual({ items: [1, 2, 3] });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/tasks',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('serializes query params', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope([]));

    await apiClient.get('/tasks', { params: { status: 'active', limit: 10 } });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('status=active');
    expect(url).toContain('limit=10');
  });

  it('serializes array params as repeated keys', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope([]));

    await apiClient.get('/tasks', { params: { ids: ['a', 'b', 'c'] } });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('ids=a');
    expect(url).toContain('ids=b');
    expect(url).toContain('ids=c');
  });

  it('omits undefined params', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({}));

    await apiClient.get('/tasks', { params: { status: undefined, limit: 5 } });

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).not.toContain('status');
    expect(url).toContain('limit=5');
  });

  it('throws ApiError on non-2xx response', async () => {
    mockFetch.mockResolvedValue(errorEnvelope(404, 'NOT_FOUND', 'Task not found'));

    const err = await apiClient.get('/tasks/999').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe('NOT_FOUND');
    expect((err as ApiError).message).toBe('Task not found');

    mockFetch.mockReset(); // back to default (return undefined)
    vi.clearAllMocks();
  });

  it('throws ApiError with requestId from meta', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Server error' },
        meta: { requestId: 'req-xyz', timestamp: '' },
      }),
    });

    try {
      await apiClient.get('/crash');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).requestId).toBe('req-xyz');
    }
  });

  it('throws ApiError with NETWORK_ERROR on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(apiClient.get('/tasks')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('re-throws AbortError unchanged', async () => {
    const abortError = Object.assign(new Error('The user aborted a request.'), {
      name: 'AbortError',
    });
    mockFetch.mockRejectedValueOnce(abortError);

    await expect(apiClient.get('/tasks')).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('handles non-JSON response with PARSE_ERROR', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    await expect(apiClient.get('/tasks')).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });

  it('handles string error field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ success: false, error: 'Bad request string' }),
    });

    await expect(apiClient.get('/bad')).rejects.toMatchObject({
      code: 'ERROR',
      message: 'Bad request string',
    });
  });
});

// ---------------------------------------------------------------------------
// POST / PUT / PATCH / DELETE
// ---------------------------------------------------------------------------

describe('apiClient.post', () => {
  it('sends JSON body with Content-Type header', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({ id: 'task-1' }));

    await apiClient.post('/tasks', { title: 'New task' });

    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ title: 'New task' }));
  });

  it('sends POST without body when not provided', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope(null));

    await apiClient.post('/tasks/reset');

    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

describe('apiClient.put', () => {
  it('uses PUT method', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({ id: 'task-1' }));
    await apiClient.put('/tasks/1', { title: 'Updated' });
    expect(mockFetch.mock.calls[0]![1]).toMatchObject({ method: 'PUT' });
  });
});

describe('apiClient.patch', () => {
  it('uses PATCH method', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({ id: 'task-1' }));
    await apiClient.patch('/tasks/1', { status: 'done' });
    expect(mockFetch.mock.calls[0]![1]).toMatchObject({ method: 'PATCH' });
  });
});

describe('apiClient.delete', () => {
  it('uses DELETE method without body', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({ deleted: true }));
    await apiClient.delete('/tasks/1');
    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

describe('apiClient.stream', () => {
  it('returns raw Response on success', async () => {
    const mockResponse = { ok: true, body: null, status: 200 } as unknown as Response;
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await apiClient.stream('/chat', { message: 'Hello' });

    expect(result).toBe(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/chat',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws ApiError when stream endpoint returns non-2xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      }),
    });

    await expect(apiClient.stream('/chat', {})).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
  });

  it('throws NETWORK_ERROR on fetch failure during stream', async () => {
    mockFetch.mockRejectedValueOnce(new Error('DNS lookup failed'));

    await expect(apiClient.stream('/chat', {})).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });
});

// ---------------------------------------------------------------------------
// Error callback
// ---------------------------------------------------------------------------

describe('apiClient.setOnError', () => {
  it('calls global error handler on API errors', async () => {
    const onError = vi.fn();
    apiClient.setOnError(onError);

    mockFetch.mockResolvedValueOnce(errorEnvelope(403, 'FORBIDDEN', 'Access denied'));

    await expect(apiClient.get('/protected')).rejects.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));

    // Reset to avoid affecting other tests
    apiClient.setOnError(() => {});
  });
});

// ---------------------------------------------------------------------------
// addOnError / removeOnError
// ---------------------------------------------------------------------------

describe('apiClient.addOnError', () => {
  it('calls multiple error listeners on API errors', async () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = apiClient.addOnError(listener1);
    const unsub2 = apiClient.addOnError(listener2);

    mockFetch.mockResolvedValueOnce(errorEnvelope(500, 'SERVER_ERROR', 'Boom'));

    await expect(apiClient.get('/fail')).rejects.toThrow();
    expect(listener1).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVER_ERROR' }));
    expect(listener2).toHaveBeenCalledWith(expect.objectContaining({ code: 'SERVER_ERROR' }));

    unsub1();
    unsub2();
  });

  it('unsubscribe stops future notifications', async () => {
    const listener = vi.fn();
    const unsub = apiClient.addOnError(listener);
    unsub();

    mockFetch.mockResolvedValueOnce(errorEnvelope(400, 'BAD', 'nope'));
    await expect(apiClient.get('/fail')).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not break if a listener throws', async () => {
    const badListener = vi.fn(() => { throw new Error('listener bug'); });
    const goodListener = vi.fn();
    const unsub1 = apiClient.addOnError(badListener);
    const unsub2 = apiClient.addOnError(goodListener);

    mockFetch.mockResolvedValueOnce(errorEnvelope(500, 'ERR', 'fail'));
    await expect(apiClient.get('/fail')).rejects.toThrow();
    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();

    unsub1();
    unsub2();
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe('apiClient edge cases', () => {
  it('returns empty object when success response has no data field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await apiClient.get('/empty');
    expect(result).toEqual({});
  });

  it('handles error response with no error field (UNKNOWN_ERROR)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ success: false }),
    });

    await expect(apiClient.get('/unknown')).rejects.toMatchObject({
      code: 'UNKNOWN_ERROR',
      message: 'Unknown error',
    });
  });

  it('normalizes path without leading slash', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({ ok: true }));

    await apiClient.get('no-slash');

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toBe('/api/v1/no-slash');
  });

  it('returns empty query string when params is undefined', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({}));

    await apiClient.get('/tasks');

    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toBe('/api/v1/tasks');
  });

  it('handles non-Error thrown from fetch (network)', async () => {
    mockFetch.mockRejectedValueOnce('string error');

    await expect(apiClient.get('/tasks')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Network error',
    });
  });

  it('passes signal option to fetch', async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce(okEnvelope({}));

    await apiClient.get('/tasks', { signal: controller.signal });

    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('merges custom headers', async () => {
    mockFetch.mockResolvedValueOnce(okEnvelope({}));

    await apiClient.get('/tasks', { headers: { 'X-Custom': 'value' } });

    const [, init] = mockFetch.mock.calls[0]! as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Custom']).toBe('value');
  });
});

// ---------------------------------------------------------------------------
// Stream edge cases
// ---------------------------------------------------------------------------

describe('apiClient.stream edge cases', () => {
  it('throws STREAM_ERROR when non-2xx body is not parseable JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not json'); },
    });

    await expect(apiClient.stream('/chat', {})).rejects.toMatchObject({
      code: 'STREAM_ERROR',
      status: 502,
    });
  });

  it('re-throws AbortError during stream unchanged', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockFetch.mockRejectedValueOnce(abortError);

    await expect(apiClient.stream('/chat', {})).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('handles non-Error thrown from fetch during stream', async () => {
    mockFetch.mockRejectedValueOnce(42);

    await expect(apiClient.stream('/chat', {})).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'Network error',
    });
  });
});

// ---------------------------------------------------------------------------
// ApiError class
// ---------------------------------------------------------------------------

describe('ApiError', () => {
  it('has correct name property', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'Missing');
    expect(err.name).toBe('ApiError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('stores all constructor fields', () => {
    const err = new ApiError(500, 'SERVER_ERROR', 'Internal error', { trace: 'x' }, 'req-123');
    expect(err.status).toBe(500);
    expect(err.code).toBe('SERVER_ERROR');
    expect(err.message).toBe('Internal error');
    expect(err.details).toEqual({ trace: 'x' });
    expect(err.requestId).toBe('req-123');
  });
});
