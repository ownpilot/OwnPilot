/**
 * OpenAIProvider Tests
 *
 * Tests for the OpenAI-compatible provider:
 * complete, stream, getModels, error handling, finish reason mapping,
 * usage mapping, tool calls, abort/timeout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CompletionRequest, Message, StreamChunk, ToolDefinition } from '../types.js';
import type { Result } from '../../types/result.js';
import type { InternalError } from '../../types/errors.js';

// Mock debug functions
vi.mock('../debug.js', () => ({
  logRequest: vi.fn(),
  logResponse: vi.fn(),
  logError: vi.fn(),
  logRetry: vi.fn(),
  buildRequestDebugInfo: vi.fn(() => ({})),
  buildResponseDebugInfo: vi.fn(() => ({})),
  calculatePayloadBreakdown: vi.fn(() => ({})),
}));

vi.mock('../../services/get-log.js', () => ({
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock retry to execute immediately (no delays)
vi.mock('../retry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../retry.js')>();
  return {
    ...original,
    withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
});

import { OpenAIProvider } from './openai-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    model: { model: 'gpt-4o' },
    ...overrides,
  };
}

function makeOpenAIResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-123',
    choices: [
      {
        message: { content: 'Hello from GPT', tool_calls: undefined },
        finish_reason: 'stop',
      },
    ],
    model: 'gpt-4o',
    created: Math.floor(Date.now() / 1000),
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
    ...overrides,
  };
}

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    body: null,
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
    body: null,
  });
}

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function mockFetchStream(chunks: string[], ok = true, status = 200) {
  const body = createSSEStream(chunks);
  return vi.fn().mockResolvedValue({
    ok,
    status,
    body,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  });
}

async function collectStream<T>(gen: AsyncGenerator<T, void, unknown>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    provider = new OpenAIProvider({
      provider: 'openai',
      apiKey: 'sk-test-key',
      timeout: 30000,
    });
  });

  afterEach(() => {
    provider.cancel();
    vi.unstubAllGlobals();
  });

  // ==================== Constructor ====================

  describe('constructor', () => {
    it('sets default baseUrl when none provided', () => {
      const p = new OpenAIProvider({ provider: 'openai', apiKey: 'key' });
      expect(p.type).toBe('openai');
    });

    it('uses custom baseUrl when provided', () => {
      const p = new OpenAIProvider({
        provider: 'openai',
        apiKey: 'key',
        baseUrl: 'https://custom.api.com/v1',
      });
      expect(p.type).toBe('openai');
    });
  });

  // ==================== isReady ====================

  describe('isReady', () => {
    it('returns true when apiKey is set', () => {
      expect(provider.isReady()).toBe(true);
    });

    it('returns false when apiKey is not set', () => {
      const p = new OpenAIProvider({ provider: 'openai' });
      expect(p.isReady()).toBe(false);
    });
  });

  // ==================== complete ====================

  describe('complete', () => {
    it('returns ValidationError when not ready', async () => {
      const p = new OpenAIProvider({ provider: 'openai' });
      const result = await p.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('API key not configured');
      }
    });

    it('returns successful response', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello from GPT');
        expect(result.value.id).toBe('chatcmpl-123');
        expect(result.value.model).toBe('gpt-4o');
        expect(result.value.finishReason).toBe('stop');
        expect(result.value.usage?.promptTokens).toBe(10);
        expect(result.value.usage?.completionTokens).toBe(20);
        expect(result.value.usage?.totalTokens).toBe(30);
      }
    });

    it('sends correct endpoint URL', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      await provider.complete(makeRequest());

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('includes stream: false in body', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      await provider.complete(makeRequest());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(false);
    });

    it('includes model parameters in body', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      await provider.complete(
        makeRequest({
          model: {
            model: 'gpt-4o',
            maxTokens: 2048,
            temperature: 0.5,
            topP: 0.9,
            frequencyPenalty: 0.1,
            presencePenalty: 0.2,
            stop: ['END'],
          },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o');
      expect(body.max_tokens).toBe(2048);
      expect(body.temperature).toBe(0.5);
      expect(body.top_p).toBe(0.9);
      expect(body.frequency_penalty).toBe(0.1);
      expect(body.presence_penalty).toBe(0.2);
      expect(body.stop).toEqual(['END']);
    });

    it('includes response_format for json mode', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      await provider.complete(
        makeRequest({
          model: { model: 'gpt-4o', responseFormat: 'json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('does not include response_format for text mode', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      await provider.complete(
        makeRequest({
          model: { model: 'gpt-4o', responseFormat: 'text' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.response_format).toBeUndefined();
    });

    it('includes user field when provided', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      await provider.complete(makeRequest({ user: 'user-123' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.user).toBe('user-123');
    });

    it('extracts tool calls from response', async () => {
      const response = makeOpenAIResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'core__read_file',
                    arguments: '{"path":"/tmp/test.txt"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });

      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.toolCalls).toHaveLength(1);
        expect(result.value.toolCalls![0].id).toBe('call_1');
        expect(result.value.toolCalls![0].name).toBe('core.read_file'); // desanitized
        expect(result.value.toolCalls![0].arguments).toBe('{"path":"/tmp/test.txt"}');
        expect(result.value.finishReason).toBe('tool_calls');
      }
    });

    it('handles empty choices array', async () => {
      const response = makeOpenAIResponse({ choices: [] });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No response from OpenAI');
      }
    });

    it('handles undefined choices', async () => {
      const response = makeOpenAIResponse({ choices: undefined });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('No response from OpenAI');
      }
    });

    it('returns error for non-OK HTTP status', async () => {
      mockFetch.mockImplementation(mockFetchError(500, 'Internal Server Error'));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('OpenAI API error');
        expect(result.error.message).toContain('500');
      }
    });

    it('returns TimeoutError on AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('TimeoutError');
      }
    });

    it('returns InternalError on general fetch failure', async () => {
      mockFetch.mockRejectedValue(new Error('DNS resolution failed'));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('OpenAI request failed');
        expect(result.error.message).toContain('DNS resolution failed');
      }
    });

    it('handles null content in response', async () => {
      const response = makeOpenAIResponse({
        choices: [
          {
            message: { content: null },
            finish_reason: 'stop',
          },
        ],
      });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('handles missing usage in response', async () => {
      const response = makeOpenAIResponse({ usage: undefined });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage).toBeUndefined();
      }
    });

    it('maps finish reason "length" correctly', async () => {
      const response = makeOpenAIResponse({
        choices: [
          { message: { content: 'truncated...' }, finish_reason: 'length' },
        ],
      });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.finishReason).toBe('length');
      }
    });

    it('maps finish reason "content_filter" correctly', async () => {
      const response = makeOpenAIResponse({
        choices: [
          { message: { content: '' }, finish_reason: 'content_filter' },
        ],
      });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.finishReason).toBe('content_filter');
      }
    });

    it('maps unknown finish reason to "stop"', async () => {
      const response = makeOpenAIResponse({
        choices: [
          { message: { content: 'ok' }, finish_reason: 'unknown_reason' },
        ],
      });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.finishReason).toBe('stop');
      }
    });

    it('includes tools in request body when provided', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'core.search',
          description: 'Search things',
          parameters: { type: 'object', properties: {} },
        },
      ];
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      await provider.complete(makeRequest({ tools }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].type).toBe('function');
      expect(body.tools[0].function.name).toBe('core__search'); // sanitized
    });

    it('includes tool_choice when provided', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'tool_a',
          description: 'desc',
          parameters: { type: 'object', properties: {} },
        },
      ];
      mockFetch.mockImplementation(mockFetchOk(makeOpenAIResponse()));

      await provider.complete(makeRequest({ tools, toolChoice: 'auto' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toBe('auto');
    });

    it('creates timestamp from response created field', async () => {
      const createdTimestamp = 1700000000;
      const response = makeOpenAIResponse({ created: createdTimestamp });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.createdAt.getTime()).toBe(createdTimestamp * 1000);
      }
    });

    it('uses fallback model name when response model is missing', async () => {
      const response = makeOpenAIResponse({ model: undefined });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe('gpt-4o');
      }
    });

    it('uses fallback id when response id is missing', async () => {
      const response = makeOpenAIResponse({ id: undefined });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('');
      }
    });
  });

  // ==================== stream ====================

  describe('stream', () => {
    it('yields error when not ready', async () => {
      const p = new OpenAIProvider({ provider: 'openai' });
      const gen = p.stream(makeRequest());
      const first = await gen.next();

      expect(first.value!.ok).toBe(false);
      if (!first.value!.ok) {
        expect(first.value!.error.message).toContain('API key not configured');
      }
    });

    it('yields error on non-OK HTTP response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        body: null,
        text: () => Promise.resolve('Unauthorized'),
      });

      const chunks = await collectStream(provider.stream(makeRequest()));

      expect(chunks).toHaveLength(1);
      expect(chunks[0].ok).toBe(false);
      if (!chunks[0].ok) {
        expect(chunks[0].error.message).toContain('OpenAI stream error: 401');
        expect(chunks[0].error.message).toContain('Unauthorized');
      }
    });

    it('yields error when response body is null', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
        text: () => Promise.resolve(''),
      });

      const chunks = await collectStream(provider.stream(makeRequest()));

      expect(chunks).toHaveLength(1);
      expect(chunks[0].ok).toBe(false);
    });

    it('streams text content deltas', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello "},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"world"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks = await collectStream(provider.stream(makeRequest()));

      // Content chunks
      const textChunks = chunks.filter((c) => c.ok && (c as any).value.content);
      expect(textChunks.length).toBeGreaterThanOrEqual(2);

      // Done chunk from [DONE]
      const doneChunk = chunks.find((c) => c.ok && (c as any).value.done === true);
      expect(doneChunk).toBeDefined();
    });

    it('streams tool call deltas', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"core__search","arguments":""}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":"}}]},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"hello\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks = await collectStream(provider.stream(makeRequest()));

      // Should have tool call chunks with desanitized name
      const tcChunks = chunks.filter(
        (c) => c.ok && (c as any).value.toolCalls?.length > 0
      );
      expect(tcChunks.length).toBeGreaterThanOrEqual(1);

      // First tool call chunk should have the name desanitized
      const firstTcChunk = tcChunks[0];
      if (firstTcChunk && firstTcChunk.ok) {
        const tc = firstTcChunk.value.toolCalls![0];
        if (tc.name) {
          expect(tc.name).toBe('core.search'); // desanitized
        }
      }
    });

    it('includes usage in final streaming chunk', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks = await collectStream(provider.stream(makeRequest()));

      const usageChunk = chunks.find((c) => c.ok && (c as any).value.usage);
      expect(usageChunk).toBeDefined();
      if (usageChunk && usageChunk.ok) {
        expect(usageChunk.value.usage!.promptTokens).toBe(5);
        expect(usageChunk.value.usage!.completionTokens).toBe(1);
        expect(usageChunk.value.usage!.totalTokens).toBe(6);
      }
    });

    it('skips malformed SSE data gracefully', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"OK"},"finish_reason":null}]}\n\n',
        'data: { broken json !!!\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks = await collectStream(provider.stream(makeRequest()));

      // Should get text chunk and done, skipping the broken one
      const okChunks = chunks.filter((c) => c.ok);
      expect(okChunks.length).toBeGreaterThanOrEqual(2);
    });

    it('ignores non-data lines in SSE stream', async () => {
      const sseChunks = [
        ':this is a comment\n',
        'event: message\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks = await collectStream(provider.stream(makeRequest()));

      const okChunks = chunks.filter((c) => c.ok);
      expect(okChunks.length).toBeGreaterThanOrEqual(2);
    });

    it('yields error when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Connection reset'));

      const chunks = await collectStream(provider.stream(makeRequest()));

      expect(chunks).toHaveLength(1);
      expect(chunks[0].ok).toBe(false);
      if (!chunks[0].ok) {
        expect(chunks[0].error.message).toContain('OpenAI stream failed');
      }
    });

    it('includes stream_options in request body', async () => {
      const sseChunks = ['data: [DONE]\n\n'];
      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      await collectStream(provider.stream(makeRequest()));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('includes finish reason in streaming chunk', async () => {
      const sseChunks = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":""},"finish_reason":"length"}]}\n\n',
        'data: [DONE]\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks = await collectStream(provider.stream(makeRequest()));

      const finishChunk = chunks.find(
        (c) => c.ok && (c as any).value.finishReason === 'length'
      );
      expect(finishChunk).toBeDefined();
    });

    it('handles empty error text gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        body: null,
        text: () => Promise.reject(new Error('could not read body')),
      });

      const chunks = await collectStream(provider.stream(makeRequest()));

      expect(chunks).toHaveLength(1);
      expect(chunks[0].ok).toBe(false);
      if (!chunks[0].ok) {
        expect(chunks[0].error.message).toContain('503');
      }
    });
  });

  // ==================== getModels ====================

  describe('getModels', () => {
    it('returns error when not ready', async () => {
      const p = new OpenAIProvider({ provider: 'openai' });
      const result = await p.getModels();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('API key not configured');
      }
    });

    it('returns model list from API', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-3.5-turbo' }],
          }),
      });

      const result = await provider.getModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']);
      }
    });

    it('sends correct endpoint and auth header', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      });

      await provider.getModels();

      expect(mockFetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/models');
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test-key');
    });

    it('returns error for non-OK status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      });

      const result = await provider.getModels();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to fetch models: 403');
      }
    });

    it('returns error when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network failed'));

      const result = await provider.getModels();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to fetch models');
        expect(result.error.message).toContain('Network failed');
      }
    });

    it('handles missing data field in models response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });

      const result = await provider.getModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });
  });

  // ==================== countTokens (inherited from BaseProvider) ====================

  describe('countTokens', () => {
    it('approximates token count', () => {
      const messages: Message[] = [{ role: 'user', content: '12345678' }]; // 8 chars
      expect(provider.countTokens(messages)).toBe(2); // ceil(8/4) = 2
    });
  });
});
