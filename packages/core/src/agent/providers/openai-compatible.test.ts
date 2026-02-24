/**
 * OpenAICompatibleProvider Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ResolvedProviderConfig, ProviderConfig } from './configs/index.js';
import type { CompletionRequest, Message, StreamChunk } from '../types.js';
import type { Result } from '../../types/result.js';
import type { InternalError } from '../../types/errors.js';
import { OpenAICompatibleProvider, createDeepSeekProvider, createGroqProvider, createTogetherProvider, createFireworksProvider, createMistralProvider, createXAIProvider, createPerplexityProvider } from './openai-compatible.js';

// Mock configs module — vi.hoisted ensures the fns exist before the hoisted vi.mock runs
const { mockLoadProviderConfig, mockResolveProviderConfig } = vi.hoisted(() => ({
  mockLoadProviderConfig: vi.fn(),
  mockResolveProviderConfig: vi.fn(),
}));

vi.mock('./configs/index.js', () => ({
  loadProviderConfig: mockLoadProviderConfig,
  resolveProviderConfig: mockResolveProviderConfig,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockConfig: ResolvedProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key',
  models: [
    {
      id: 'gpt-4',
      name: 'GPT-4',
      contextWindow: 128_000,
      maxOutput: 4096,
      inputPrice: 10,
      outputPrice: 30,
      capabilities: ['chat', 'code', 'vision'],
      default: true,
    },
    {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      contextWindow: 16_000,
      maxOutput: 4096,
      inputPrice: 0.5,
      outputPrice: 1.5,
      capabilities: ['chat', 'code'],
    },
  ],
  features: {
    streaming: true,
    toolUse: true,
    vision: true,
    jsonMode: true,
    systemMessage: true,
  },
};

/** ProviderConfig (includes apiKeyEnv, no apiKey) */
const mockRawConfig: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  type: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  models: mockConfig.models,
  features: mockConfig.features,
};

const makeRequest = (overrides?: Partial<CompletionRequest>): CompletionRequest => ({
  messages: [{ role: 'user' as const, content: 'Hello' }],
  model: {
    model: 'gpt-4',
    maxTokens: 1024,
    temperature: 0.7,
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(data: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('OpenAICompatibleProvider', () => {
  // -------------------------------------------------------------------------
  // Static factories
  // -------------------------------------------------------------------------
  describe('fromProviderId', () => {
    it('returns a provider when config is resolved', () => {
      mockResolveProviderConfig.mockReturnValue(mockConfig);

      const provider = OpenAICompatibleProvider.fromProviderId('openai');

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider!.type).toBe('openai');
      expect(mockResolveProviderConfig).toHaveBeenCalledWith('openai');
    });

    it('returns null when config is not found', () => {
      mockResolveProviderConfig.mockReturnValue(null);

      const provider = OpenAICompatibleProvider.fromProviderId('nonexistent');

      expect(provider).toBeNull();
    });
  });

  describe('fromProviderIdWithKey', () => {
    it('creates a provider with the given API key', () => {
      mockLoadProviderConfig.mockReturnValue(mockRawConfig);

      const provider = OpenAICompatibleProvider.fromProviderIdWithKey('openai', 'sk-custom-key');

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider!.isReady()).toBe(true);
    });

    it('returns null when raw config is not found', () => {
      mockLoadProviderConfig.mockReturnValue(null);

      const provider = OpenAICompatibleProvider.fromProviderIdWithKey('nonexistent', 'sk-key');

      expect(provider).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // isReady
  // -------------------------------------------------------------------------
  describe('isReady', () => {
    it('returns true when apiKey and baseUrl are present', () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      expect(provider.isReady()).toBe(true);
    });

    it('returns false when apiKey is missing', () => {
      const provider = new OpenAICompatibleProvider({ ...mockConfig, apiKey: '' });
      expect(provider.isReady()).toBe(false);
    });

    it('returns false when baseUrl is missing', () => {
      const provider = new OpenAICompatibleProvider({ ...mockConfig, baseUrl: '' });
      expect(provider.isReady()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getDefaultModel
  // -------------------------------------------------------------------------
  describe('getDefaultModel', () => {
    it('returns the model marked as default', () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      expect(provider.getDefaultModel()).toBe('gpt-4');
    });

    it('returns the first model when none is marked default', () => {
      const config: ResolvedProviderConfig = {
        ...mockConfig,
        models: mockConfig.models.map((m) => ({ ...m, default: undefined })),
      };
      const provider = new OpenAICompatibleProvider(config);
      expect(provider.getDefaultModel()).toBe('gpt-4');
    });

    it('returns undefined when models list is empty', () => {
      const provider = new OpenAICompatibleProvider({ ...mockConfig, models: [] });
      expect(provider.getDefaultModel()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getConfig
  // -------------------------------------------------------------------------
  describe('getConfig', () => {
    it('returns raw provider config via loadProviderConfig', () => {
      mockLoadProviderConfig.mockReturnValue(mockRawConfig);
      const provider = new OpenAICompatibleProvider(mockConfig);

      const config = provider.getConfig();

      expect(config).toBe(mockRawConfig);
      expect(mockLoadProviderConfig).toHaveBeenCalledWith('openai');
    });

    it('returns undefined when loadProviderConfig returns null', () => {
      mockLoadProviderConfig.mockReturnValue(null);
      const provider = new OpenAICompatibleProvider(mockConfig);

      expect(provider.getConfig()).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getModels
  // -------------------------------------------------------------------------
  describe('getModels', () => {
    it('returns model IDs from config without an API call', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);

      const result = await provider.getModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['gpt-4', 'gpt-3.5-turbo']);
      }
    });
  });

  // -------------------------------------------------------------------------
  // countTokens
  // -------------------------------------------------------------------------
  describe('countTokens', () => {
    it('counts string content as chars / 4 rounded up', () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      // "Hello" = 5 chars => ceil(5/4) = 2
      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      expect(provider.countTokens(messages)).toBe(2);
    });

    it('counts ContentPart[] content (text parts only)', () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      // "Hello World" = 11 chars => ceil(11/4) = 3
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: ' World' },
          ],
        },
      ];
      expect(provider.countTokens(messages)).toBe(3);
    });

    it('ignores non-text content parts', () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hi' },
            { type: 'image', data: 'base64data', mediaType: 'image/png' },
          ],
        },
      ];
      // Only "Hi" = 2 chars => ceil(2/4) = 1
      expect(provider.countTokens(messages)).toBe(1);
    });

    it('sums across multiple messages', () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const messages: Message[] = [
        { role: 'system', content: 'You are helpful.' }, // 16 chars
        { role: 'user', content: 'Hi' }, // 2 chars
      ];
      // total = 18 chars => ceil(18/4) = 5
      expect(provider.countTokens(messages)).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------
  describe('cancel', () => {
    it('aborts the abort controller', () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      // Trigger creation of an abort controller by starting a request
      const fetchMock = mockFetchResponse({ choices: [{ message: { content: 'hi' } }] }, true, 200);
      vi.stubGlobal('fetch', fetchMock);

      // Start request (don't await it yet)
      const promise = provider.complete(makeRequest());
      // Cancel immediately
      provider.cancel();
      // The request may resolve or reject depending on timing; we just verify cancel doesn't throw
      return promise.then(() => {}).catch(() => {});
    });
  });

  // -------------------------------------------------------------------------
  // complete
  // -------------------------------------------------------------------------
  describe('complete', () => {
    it('returns ValidationError when provider is not ready', async () => {
      const provider = new OpenAICompatibleProvider({ ...mockConfig, apiKey: '' });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toContain('not configured');
      }
    });

    it('returns ValidationError when no model is specified', async () => {
      const provider = new OpenAICompatibleProvider({ ...mockConfig, models: [] });
      const request = makeRequest({ model: { model: '' } });

      const result = await provider.complete(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.message).toBe('No model specified');
      }
    });

    it('makes a successful completion and parses the response', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const apiResponse = {
        id: 'chatcmpl-123',
        model: 'gpt-4',
        created: 1700000000,
        choices: [
          {
            message: { content: 'Hello there!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };
      vi.stubGlobal('fetch', mockFetchResponse(apiResponse));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe('chatcmpl-123');
        expect(result.value.content).toBe('Hello there!');
        expect(result.value.finishReason).toBe('stop');
        expect(result.value.model).toBe('gpt-4');
        expect(result.value.usage).toEqual({
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        });
        expect(result.value.createdAt).toEqual(new Date(1700000000 * 1000));
      }
    });

    it('sends correct request body to the API', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const fetchMock = mockFetchResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      });
      vi.stubGlobal('fetch', fetchMock);

      const request = makeRequest({
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        ],
        toolChoice: 'auto',
        user: 'user-123',
      });

      await provider.complete(request);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({ method: 'POST' })
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4');
      expect(body.stream).toBe(false);
      expect(body.max_tokens).toBe(1024);
      expect(body.temperature).toBe(0.7);
      expect(body.user).toBe('user-123');
      expect(body.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: {}, required: [] },
          },
        },
      ]);
      expect(body.tool_choice).toBe('auto');
    });

    it('handles reasoning_content (DeepSeek R1 style)', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const apiResponse = {
        choices: [
          {
            message: {
              content: 'The answer is 42.',
              reasoning_content: 'Let me think step by step...',
            },
            finish_reason: 'stop',
          },
        ],
      };
      vi.stubGlobal('fetch', mockFetchResponse(apiResponse));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe(
          '<thinking>\nLet me think step by step...\n</thinking>\n\nThe answer is 42.'
        );
      }
    });

    it('handles tool calls in the response', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const apiResponse = {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"London"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };
      vi.stubGlobal('fetch', mockFetchResponse(apiResponse));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
        expect(result.value.finishReason).toBe('tool_calls');
        expect(result.value.toolCalls).toEqual([
          {
            id: 'call_abc123',
            name: 'get_weather',
            arguments: '{"location":"London"}',
          },
        ]);
      }
    });

    it('returns InternalError on non-ok response', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      vi.stubGlobal('fetch', mockFetchResponse({ error: { message: 'Rate limited' } }, false, 429));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('429');
      }
    });

    it('returns InternalError when response has no choices', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      vi.stubGlobal('fetch', mockFetchResponse({ choices: [] }));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('No response');
      }
    });

    it('returns TimeoutError on AbortError', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    });

    it('returns InternalError on other fetch errors', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Network failure');
      }
    });

    it('uses defaultModel when request model is empty', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const fetchMock = mockFetchResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      });
      vi.stubGlobal('fetch', fetchMock);

      await provider.complete(makeRequest({ model: { model: '' } }));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4'); // default model
    });

    it('includes custom headers from config', async () => {
      const provider = new OpenAICompatibleProvider({
        ...mockConfig,
        headers: { 'X-Custom': 'value' },
      });
      const fetchMock = mockFetchResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      });
      vi.stubGlobal('fetch', fetchMock);

      await provider.complete(makeRequest());

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['X-Custom']).toBe('value');
      expect(headers['Authorization']).toBe('Bearer sk-test-key');
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  // -------------------------------------------------------------------------
  // stream
  // -------------------------------------------------------------------------
  describe('stream', () => {
    it('yields error when provider is not ready', async () => {
      const provider = new OpenAICompatibleProvider({ ...mockConfig, apiKey: '' });

      const chunks: unknown[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
        })
      );
    });

    it('yields error when no model is specified', async () => {
      const provider = new OpenAICompatibleProvider({ ...mockConfig, models: [] });
      const request = makeRequest({ model: { model: '' } });

      const chunks: unknown[] = [];
      for await (const chunk of provider.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
        })
      );
    });

    it('parses SSE chunks and yields content', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const sseLines = [
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" World"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      vi.stubGlobal('fetch', mockFetchStream(sseLines));

      const chunks: Array<Result<StreamChunk, InternalError>> = [];
      for await (const chunk of provider.stream(makeRequest())) {
        if (chunk.ok) {
          chunks.push(chunk);
        }
      }

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      expect(chunks[0].value.content).toBe('Hello');
      expect(chunks[1].value.content).toBe(' World');
      // The last chunk is the [DONE] marker
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.value.done).toBe(true);
    });

    it('handles [DONE] marker and terminates', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const sseLines = [
        'data: {"id":"x","choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      vi.stubGlobal('fetch', mockFetchStream(sseLines));

      const chunks: unknown[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // Content chunk + DONE chunk
      expect(chunks.length).toBe(2);
    });

    it('handles reasoning_content in streaming with metadata.type', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const sseLines = [
        'data: {"id":"x","choices":[{"delta":{"reasoning_content":"Thinking..."}}]}\n\n',
        'data: {"id":"x","choices":[{"delta":{"content":"Answer"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      vi.stubGlobal('fetch', mockFetchStream(sseLines));

      const chunks: Array<Result<StreamChunk, InternalError>> = [];
      for await (const chunk of provider.stream(makeRequest())) {
        if (chunk.ok) {
          chunks.push(chunk);
        }
      }

      // First chunk: reasoning content
      expect(chunks[0].ok && chunks[0].value.content).toBe('Thinking...');
      expect(chunks[0].ok && chunks[0].value.metadata).toEqual({ type: 'reasoning' });

      // Second chunk: transition newline
      expect(chunks[1].value.content).toBe('\n\n');

      // Third chunk: actual content
      expect(chunks[2].value.content).toBe('Answer');
    });

    it('handles tool_calls in delta', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const sseLines = [
        'data: {"id":"x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"city\\":"}}]}}]}\n\n',
        'data: {"id":"x","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"London\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ];
      vi.stubGlobal('fetch', mockFetchStream(sseLines));

      const chunks: Array<Result<StreamChunk, InternalError>> = [];
      for await (const chunk of provider.stream(makeRequest())) {
        if (chunk.ok) {
          chunks.push(chunk);
        }
      }

      // First chunk should have tool call info
      expect(chunks[0].ok && chunks[0].value.toolCalls).toBeDefined();
      expect(chunks[0].ok && chunks[0].value.toolCalls?.[0].id).toBe('call_1');
      expect(chunks[0].ok && chunks[0].value.toolCalls?.[0].name).toBe('get_weather');
    });

    it('skips malformed chunks without crashing', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const sseLines = [
        'data: {"id":"x","choices":[{"delta":{"content":"A"}}]}\n\n',
        'data: {INVALID JSON}\n\n',
        'data: {"id":"x","choices":[{"delta":{"content":"B"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      vi.stubGlobal('fetch', mockFetchStream(sseLines));

      const chunks: Array<Result<StreamChunk, InternalError>> = [];
      for await (const chunk of provider.stream(makeRequest())) {
        if (chunk.ok) {
          chunks.push(chunk);
        }
      }

      // Should have A, B, and DONE (the malformed chunk is silently skipped)
      const contentChunks = chunks.filter((c) => c.ok && c.value.content);
      expect(contentChunks.map((c) => c.ok && c.value.content)).toContain('A');
      expect(contentChunks.map((c) => c.ok && c.value.content)).toContain('B');
    });

    it('yields InternalError on non-ok fetch response', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          body: null,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('Server error'),
        })
      );

      const chunks: unknown[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
        })
      );
    });

    it('yields InternalError on fetch throw', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));

      const chunks: unknown[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({
            code: 'INTERNAL_ERROR',
            message: expect.stringContaining('Network down'),
          }),
        })
      );
    });

    it('includes stream_options in request body', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const fetchMock = mockFetchStream(['data: [DONE]\n\n']);
      vi.stubGlobal('fetch', fetchMock);

      const chunks: unknown[] = [];
      for await (const _chunk of provider.stream(makeRequest())) {
        chunks.push(_chunk);
      }

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('includes finish_reason and usage in final chunk', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const sseLines = [
        'data: {"id":"x","choices":[{"delta":{"content":"Done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n',
        'data: [DONE]\n\n',
      ];
      vi.stubGlobal('fetch', mockFetchStream(sseLines));

      const chunks: Array<Result<StreamChunk, InternalError>> = [];
      for await (const chunk of provider.stream(makeRequest())) {
        if (chunk.ok) {
          chunks.push(chunk);
        }
      }

      // The content chunk with finish_reason
      const contentChunk = chunks.find((c) => c.ok && c.value.content === 'Done');
      expect(contentChunk).toBeDefined();
      expect(contentChunk?.ok && contentChunk.value.done).toBe(true);
      expect(contentChunk?.ok && contentChunk.value.finishReason).toBe('stop');
      expect(contentChunk?.ok && contentChunk.value.usage).toEqual({
        promptTokens: 5,
        completionTokens: 3,
        totalTokens: 8,
      });
    });

    it('skips lines that do not start with "data: "', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const sseLines = [
        ': comment line\n\n',
        'event: ping\n\n',
        'data: {"id":"x","choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ];
      vi.stubGlobal('fetch', mockFetchStream(sseLines));

      const chunks: Array<Result<StreamChunk, InternalError>> = [];
      for await (const chunk of provider.stream(makeRequest())) {
        if (chunk.ok) {
          chunks.push(chunk);
        }
      }

      const contentChunks = chunks.filter((c) => c.ok && c.value.content);
      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0].ok && contentChunks[0].value.content).toBe('ok');
    });
  });

  // -------------------------------------------------------------------------
  // fetchModelsFromAPI
  // -------------------------------------------------------------------------
  describe('fetchModelsFromAPI', () => {
    it('returns models from the API /models endpoint', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [{ id: 'gpt-4' }, { id: 'gpt-4-turbo' }, { id: 'gpt-3.5-turbo' }],
            }),
        })
      );

      const result = await provider.fetchModelsFromAPI();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo']);
      }
    });

    it('sends correct authorization headers', async () => {
      const provider = new OpenAICompatibleProvider({
        ...mockConfig,
        headers: { 'X-Org': 'test-org' },
      });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await provider.fetchModelsFromAPI();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/models',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key',
            'X-Org': 'test-org',
          }),
        })
      );
    });

    it('falls back to config models on API error', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

      const result = await provider.fetchModelsFromAPI();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['gpt-4', 'gpt-3.5-turbo']);
      }
    });

    it('falls back to config models on network error', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS fail')));

      const result = await provider.fetchModelsFromAPI();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['gpt-4', 'gpt-3.5-turbo']);
      }
    });

    it('returns error when provider is not ready', async () => {
      const provider = new OpenAICompatibleProvider({ ...mockConfig, apiKey: '' });

      const result = await provider.fetchModelsFromAPI();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('not configured');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Request body construction edge cases
  // -------------------------------------------------------------------------
  describe('request body construction', () => {
    it('omits tools when provider does not support toolUse', async () => {
      const provider = new OpenAICompatibleProvider({
        ...mockConfig,
        features: { ...mockConfig.features, toolUse: false },
      });
      const fetchMock = mockFetchResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      });
      vi.stubGlobal('fetch', fetchMock);

      await provider.complete(
        makeRequest({
          tools: [
            {
              name: 'test',
              description: 'test',
              parameters: { type: 'object', properties: {} },
            },
          ],
        })
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
    });

    it('includes response_format when jsonMode is enabled and requested', async () => {
      const provider = new OpenAICompatibleProvider(mockConfig);
      const fetchMock = mockFetchResponse({
        choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
      });
      vi.stubGlobal('fetch', fetchMock);

      await provider.complete(makeRequest({ model: { model: 'gpt-4', responseFormat: 'json' } }));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('omits response_format when provider does not support jsonMode', async () => {
      const provider = new OpenAICompatibleProvider({
        ...mockConfig,
        features: { ...mockConfig.features, jsonMode: false },
      });
      const fetchMock = mockFetchResponse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      });
      vi.stubGlobal('fetch', fetchMock);

      await provider.complete(makeRequest({ model: { model: 'gpt-4', responseFormat: 'json' } }));

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.response_format).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Convenience factory functions
  // -------------------------------------------------------------------------
  describe('convenience factories', () => {
    it('createOpenAICompatibleProvider delegates to fromProviderId', async () => {
      mockResolveProviderConfig.mockReturnValue(mockConfig);

      const { createOpenAICompatibleProvider } = await import('./openai-compatible.js');
      const provider = createOpenAICompatibleProvider('openai');

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(mockResolveProviderConfig).toHaveBeenCalledWith('openai');
    });
  });
});
