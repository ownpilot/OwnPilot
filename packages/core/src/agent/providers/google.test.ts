/**
 * GoogleProvider Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Error types checked via constructor.name to avoid cross-module instanceof issues
import type { CompletionRequest, Message, StreamChunk } from '../types.js';
import type { ResolvedProviderConfig, ProviderConfig } from './configs/index.js';
import type { Result } from '../../types/result.js';

// Mock debug functions
vi.mock('../debug.js', () => ({
  logRequest: vi.fn(),
  logResponse: vi.fn(),
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

const mockLoadProviderConfig = vi.fn();
const mockResolveProviderConfig = vi.fn();

vi.mock('./configs/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./configs/index.js')>();
  return {
    ...original,
    loadProviderConfig: (...args: unknown[]) => mockLoadProviderConfig(...args),
    resolveProviderConfig: (...args: unknown[]) => mockResolveProviderConfig(...args),
  };
});

import { GoogleProvider, createGoogleProvider } from './google.js';

// --- Helpers ---

function makeMockConfig(overrides: Partial<ResolvedProviderConfig> = {}): ResolvedProviderConfig {
  return {
    id: 'google',
    name: 'Google AI',
    type: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'test-google-key',
    models: [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        contextWindow: 1000000,
        maxOutput: 8192,
        inputPrice: 0.1,
        outputPrice: 0.4,
        capabilities: ['chat', 'code', 'vision'],
        default: true,
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        contextWindow: 2000000,
        maxOutput: 8192,
        inputPrice: 1.25,
        outputPrice: 5.0,
        capabilities: ['chat', 'code', 'vision'],
      },
    ],
    features: {
      streaming: true,
      toolUse: true,
      vision: true,
      jsonMode: true,
      systemMessage: true,
    },
    timeout: 30000,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    model: { model: 'gemini-2.0-flash' },
    ...overrides,
  };
}

function makeGeminiResponse(overrides: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: 'Hello from Gemini' }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30,
    },
    ...overrides,
  };
}

// --- Tests ---

describe('GoogleProvider', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ==================== Static Factories ====================

  describe('fromEnv', () => {
    it('returns provider when config is resolved', () => {
      const config = makeMockConfig();
      mockResolveProviderConfig.mockReturnValue(config);

      const provider = GoogleProvider.fromEnv();

      expect(provider).toBeInstanceOf(GoogleProvider);
      expect(mockResolveProviderConfig).toHaveBeenCalledWith('google');
    });

    it('returns null when no config available', () => {
      mockResolveProviderConfig.mockReturnValue(null);

      const provider = GoogleProvider.fromEnv();

      expect(provider).toBeNull();
    });
  });

  describe('withApiKey', () => {
    it('creates provider with explicit API key', () => {
      const rawConfig: ProviderConfig = {
        id: 'google',
        name: 'Google AI',
        type: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKeyEnv: 'GOOGLE_API_KEY',
        models: [
          {
            id: 'gemini-2.0-flash',
            name: 'Gemini 2.0 Flash',
            contextWindow: 1000000,
            maxOutput: 8192,
            inputPrice: 0.1,
            outputPrice: 0.4,
            capabilities: ['chat'],
            default: true,
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
      mockLoadProviderConfig.mockReturnValue(rawConfig);

      const provider = GoogleProvider.withApiKey('my-explicit-key');

      expect(provider).toBeInstanceOf(GoogleProvider);
      expect(provider!.isReady()).toBe(true);
    });

    it('returns null when no provider config found', () => {
      mockLoadProviderConfig.mockReturnValue(null);

      const provider = GoogleProvider.withApiKey('some-key');

      expect(provider).toBeNull();
    });
  });

  describe('createGoogleProvider', () => {
    it('uses withApiKey when config has apiKey', () => {
      const rawConfig: ProviderConfig = {
        id: 'google',
        name: 'Google AI',
        type: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKeyEnv: 'GOOGLE_API_KEY',
        models: [],
        features: {
          streaming: true,
          toolUse: true,
          vision: true,
          jsonMode: true,
          systemMessage: true,
        },
      };
      mockLoadProviderConfig.mockReturnValue(rawConfig);

      const provider = createGoogleProvider({ provider: 'google', model: 'x', apiKey: 'explicit' });

      expect(mockLoadProviderConfig).toHaveBeenCalledWith('google');
      expect(provider).toBeInstanceOf(GoogleProvider);
    });

    it('uses fromEnv when no apiKey in config', () => {
      const config = makeMockConfig();
      mockResolveProviderConfig.mockReturnValue(config);

      const provider = createGoogleProvider();

      expect(mockResolveProviderConfig).toHaveBeenCalledWith('google');
      expect(provider).toBeInstanceOf(GoogleProvider);
    });
  });

  // ==================== Instance Methods ====================

  describe('isReady', () => {
    it('returns true when apiKey is set', () => {
      const provider = new GoogleProvider(makeMockConfig());
      expect(provider.isReady()).toBe(true);
    });

    it('returns false when apiKey is empty', () => {
      const provider = new GoogleProvider(makeMockConfig({ apiKey: '' }));
      expect(provider.isReady()).toBe(false);
    });
  });

  describe('getDefaultModel', () => {
    it('returns the model marked as default', () => {
      const provider = new GoogleProvider(makeMockConfig());
      expect(provider.getDefaultModel()).toBe('gemini-2.0-flash');
    });

    it('returns first model when none marked default', () => {
      const config = makeMockConfig({
        models: [
          {
            id: 'gemini-1.5-pro',
            name: 'Gemini 1.5 Pro',
            contextWindow: 2000000,
            maxOutput: 8192,
            inputPrice: 1.25,
            outputPrice: 5.0,
            capabilities: ['chat'],
          },
        ],
      });
      const provider = new GoogleProvider(config);
      expect(provider.getDefaultModel()).toBe('gemini-1.5-pro');
    });

    it('returns undefined when no models configured', () => {
      const config = makeMockConfig({ models: [] });
      const provider = new GoogleProvider(config);
      expect(provider.getDefaultModel()).toBeUndefined();
    });
  });

  describe('getModels', () => {
    it('returns model IDs from config', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      const result = await provider.getModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(['gemini-2.0-flash', 'gemini-1.5-pro']);
      }
    });
  });

  describe('getConfig', () => {
    it('returns provider config from loadProviderConfig', () => {
      const rawConfig = { id: 'google', name: 'Google AI' };
      mockLoadProviderConfig.mockReturnValue(rawConfig);

      const provider = new GoogleProvider(makeMockConfig());
      expect(provider.getConfig()).toBe(rawConfig);
    });

    it('returns undefined when no raw config found', () => {
      mockLoadProviderConfig.mockReturnValue(null);

      const provider = new GoogleProvider(makeMockConfig());
      expect(provider.getConfig()).toBeUndefined();
    });
  });

  describe('countTokens', () => {
    it('calculates token count from string messages', () => {
      const provider = new GoogleProvider(makeMockConfig());
      const messages: Message[] = [
        { role: 'user', content: 'Hello world' }, // 11 chars
      ];
      // ceil(11 / 4) = 3
      expect(provider.countTokens(messages)).toBe(3);
    });

    it('calculates token count from ContentPart messages', () => {
      const provider = new GoogleProvider(makeMockConfig());
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' }, // 5 chars
            { type: 'text', text: 'World' }, // 5 chars
          ],
        },
      ];
      // ceil(10 / 4) = 3
      expect(provider.countTokens(messages)).toBe(3);
    });

    it('handles mixed string and ContentPart messages', () => {
      const provider = new GoogleProvider(makeMockConfig());
      const messages: Message[] = [
        { role: 'system', content: 'Be helpful' }, // 10 chars
        {
          role: 'user',
          content: [{ type: 'text', text: 'Question?' }], // 9 chars
        },
      ];
      // ceil(19 / 4) = 5
      expect(provider.countTokens(messages)).toBe(5);
    });

    it('ignores non-text content parts', () => {
      const provider = new GoogleProvider(makeMockConfig());
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' }, // 5 chars
            { type: 'image', data: 'base64data', mediaType: 'image/png' },
          ],
        },
      ];
      // ceil(5 / 4) = 2
      expect(provider.countTokens(messages)).toBe(2);
    });
  });

  describe('cancel', () => {
    it('aborts the current request and returns TimeoutError', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      vi.useFakeTimers();

      // Mock fetch to listen for abort signal and reject with AbortError
      mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException('The operation was aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      });

      const promise = provider.complete(makeRequest());

      // Let microtasks settle so fetch is called
      await vi.advanceTimersByTimeAsync(0);

      // Cancel the request
      provider.cancel();

      // Advance timers to flush retry delays (AbortError is retryable, so all 3 retries fire)
      // Each retry also creates a new AbortController (not cancelled), but the fetch
      // is also rejected on abort from the internal timeout. We need to flush all retries.
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      // Also flush the internal abort timeouts (30s each)
      await vi.advanceTimersByTimeAsync(30000);
      await vi.advanceTimersByTimeAsync(30000);

      const result = await promise;
      vi.useRealTimers();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('TimeoutError');
      }
    });

    it('does not throw when called without an active request', () => {
      const provider = new GoogleProvider(makeMockConfig());
      expect(() => provider.cancel()).not.toThrow();
    });
  });

  // ==================== complete() ====================

  describe('complete', () => {
    it('returns ValidationError when not ready', async () => {
      const provider = new GoogleProvider(makeMockConfig({ apiKey: '' }));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('ValidationError');
        expect(result.error.message).toBe('Google API key not configured');
      }
    });

    it('returns ValidationError when no model specified', async () => {
      const config = makeMockConfig({ models: [] });
      const provider = new GoogleProvider(config);

      const result = await provider.complete(makeRequest({ model: { model: '' } }));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('ValidationError');
        expect(result.error.message).toBe('No model specified');
      }
    });

    it('completes successfully with text response', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeGeminiResponse(),
      });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello from Gemini');
        expect(result.value.model).toBe('gemini-2.0-flash');
        expect(result.value.finishReason).toBe('stop');
        expect(result.value.usage).toEqual({
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        });
        expect(result.value.id).toMatch(/^gemini_/);
        expect(result.value.createdAt).toBeInstanceOf(Date);
      }

      // Verify fetch was called with correct URL and headers
      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-goog-api-key': 'test-google-key',
          }),
        })
      );
    });

    it('uses default model when request model is empty', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeGeminiResponse(),
      });

      const result = await provider.complete(makeRequest({ model: { model: '' } }));

      // Default model is gemini-2.0-flash
      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('gemini-2.0-flash:generateContent'),
        expect.anything()
      );
    });

    it('handles thinking/thought content', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Let me think about this...', thought: true },
                  { text: 'The answer is 42.' },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            thoughtsTokenCount: 5,
            totalTokenCount: 35,
          },
        }),
      });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe(
          '<thinking>\nLet me think about this...\n</thinking>\n\nThe answer is 42.'
        );
        // completionTokens = candidatesTokenCount + thoughtsTokenCount = 20 + 5
        expect(result.value.usage?.completionTokens).toBe(25);
      }
    });

    it('handles function calls with thoughtSignature', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'get_weather',
                      args: { location: 'Tokyo' },
                    },
                    thoughtSignature: 'sig_abc123',
                  },
                ],
              },
              finishReason: 'FUNCTION_CALL',
            },
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 25,
            totalTokenCount: 40,
          },
        }),
      });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.finishReason).toBe('tool_calls');
        expect(result.value.toolCalls).toHaveLength(1);
        const tc = result.value.toolCalls![0];
        expect(tc.name).toBe('get_weather');
        expect(JSON.parse(tc.arguments)).toEqual({ location: 'Tokyo' });
        expect(tc.metadata).toEqual({ thoughtSignature: 'sig_abc123' });
        expect(tc.id).toMatch(/^call_/);
      }
    });

    it('handles function calls without thoughtSignature', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: 'search',
                      args: { query: 'test' },
                    },
                  },
                ],
              },
              finishReason: 'FUNCTION_CALL',
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
        }),
      });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const tc = result.value.toolCalls![0];
        expect(tc.metadata).toBeUndefined();
      }
    });

    it('maps Gemini finish reasons correctly', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      const testCases: Array<{ gemini: string; expected: string }> = [
        { gemini: 'STOP', expected: 'stop' },
        { gemini: 'MAX_TOKENS', expected: 'length' },
        { gemini: 'SAFETY', expected: 'content_filter' },
        { gemini: 'RECITATION', expected: 'content_filter' },
        { gemini: 'BLOCKLIST', expected: 'content_filter' },
        { gemini: 'FUNCTION_CALL', expected: 'tool_calls' },
        { gemini: 'UNKNOWN_REASON', expected: 'stop' },
      ];

      for (const { gemini, expected } of testCases) {
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: { parts: [{ text: 'x' }] },
                finishReason: gemini,
              },
            ],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
          }),
        });

        const result = await provider.complete(makeRequest());
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.finishReason).toBe(expected);
        }
      }
    });

    it('returns error on non-ok API response', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request: invalid model',
      });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('InternalError');
        expect(result.error.message).toContain('400');
        expect(result.error.message).toContain('Bad Request');
      }
    });

    it('returns error when response has no candidates', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [] }),
      });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('InternalError');
        expect(result.error.message).toContain('No response from Google');
      }
    });

    it('returns TimeoutError on abort', async () => {
      const config = makeMockConfig({ timeout: 100 });
      const provider = new GoogleProvider(config);

      // Simulate AbortError thrown by fetch
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      vi.useFakeTimers();
      const promise = provider.complete(makeRequest());
      // Advance past retry delays (AbortError is retryable)
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(4000);
      const result = await promise;
      vi.useRealTimers();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('TimeoutError');
        expect(result.error.message).toContain('Google request');
      }
    });

    it('returns InternalError on network error', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockRejectedValue(new Error('ECONNRESET'));

      // Retries on ECONNRESET — all 3 attempts will fail
      vi.useFakeTimers();
      const promise = provider.complete(makeRequest());
      await vi.advanceTimersByTimeAsync(1000); // first retry delay
      await vi.advanceTimersByTimeAsync(2000); // second retry delay
      const result = await promise;
      vi.useRealTimers();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('InternalError');
        expect(result.error.message).toContain('ECONNRESET');
      }
    });

    it('retries on 429 status and succeeds on second attempt', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      // First attempt: 429 rate limit
      // Second attempt: success
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            text: async () => 'Rate limit exceeded 429',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => makeGeminiResponse(),
        };
      });

      vi.useFakeTimers();
      const promise = provider.complete(makeRequest());
      // Advance past the first retry delay (1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;
      vi.useRealTimers();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello from Gemini');
      }
      expect(callCount).toBe(2);
    });

    it('retries on 500 status up to maxRetries then returns error', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error 500',
      });

      vi.useFakeTimers();
      const promise = provider.complete(makeRequest());
      // Advance past retry delays: 1000ms, then 2000ms
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;
      vi.useRealTimers();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.constructor.name).toBe('InternalError');
        expect(result.error.message).toContain('500');
      }
      // 3 attempts total (maxRetries = 3)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('does not retry on non-retryable errors (e.g., 400)', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      // Should only call fetch once (no retries for 400)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles response with no usageMetadata', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: { parts: [{ text: 'No usage info' }] },
              finishReason: 'STOP',
            },
          ],
        }),
      });

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('No usage info');
        expect(result.value.usage).toBeUndefined();
      }
    });

    it('sends system instruction in request body', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeGeminiResponse(),
      });

      await provider.complete(
        makeRequest({
          messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Hi' },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.systemInstruction).toEqual({
        parts: [{ text: 'You are a helpful assistant' }],
      });
      // System message should NOT appear in contents
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].role).toBe('user');
    });

    it('includes tools in request when configured', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => makeGeminiResponse(),
      });

      await provider.complete(
        makeRequest({
          tools: [
            {
              name: 'get_weather',
              description: 'Get weather data',
              parameters: {
                type: 'object',
                properties: {
                  location: { type: 'string', description: 'City name' },
                },
                required: ['location'],
              },
            },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toEqual([
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'Get weather data',
              parameters: {
                type: 'object',
                properties: { location: { type: 'string', description: 'City name' } },
                required: ['location'],
              },
            },
          ],
        },
      ]);
    });
  });

  // ==================== stream() ====================

  describe('stream', () => {
    it('yields error when not ready', async () => {
      const provider = new GoogleProvider(makeMockConfig({ apiKey: '' }));

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toHaveProperty('ok', false);
      const firstChunk = chunks[0];
      if (!firstChunk.ok) {
        expect(firstChunk.error.constructor.name).toBe('InternalError');
        expect(firstChunk.error.message).toBe('Google API key not configured');
      }
    });

    it('yields error when no model specified', async () => {
      const config = makeMockConfig({ models: [] });
      const provider = new GoogleProvider(config);

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest({ model: { model: '' } }))) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      const firstChunk = chunks[0];
      expect(firstChunk.ok).toBe(false);
      if (!firstChunk.ok) {
        expect(firstChunk.error.message).toBe('No model specified');
      }
    });

    it('parses SSE chunks correctly', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      const sseData = [
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
        })}\n`,
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: ' world' }] } }],
        })}\n`,
        `data: ${JSON.stringify({
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
        })}\n`,
      ].join('\n');

      const encoder = new TextEncoder();
      let readCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: encoder.encode(sseData) };
          }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // Should have: text "Hello", text " world", done chunk
      expect(chunks.length).toBeGreaterThanOrEqual(3);

      // First chunk - text
      const first = chunks[0];
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.value.content).toBe('Hello');
        expect(first.value.done).toBe(false);
      }

      // Second chunk - text
      const second = chunks[1];
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.content).toBe(' world');
        expect(second.value.done).toBe(false);
      }

      // Done chunk
      const last = chunks[chunks.length - 1];
      expect(last.ok).toBe(true);
      if (last.ok) {
        expect(last.value.done).toBe(true);
        expect(last.value.finishReason).toBe('stop');
        expect(last.value.usage).toEqual({
          promptTokens: 5,
          completionTokens: 10,
          totalTokens: 15,
        });
      }
    });

    it('handles function call in stream', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      const sseData = `data: ${JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { name: 'search', args: { query: 'weather' } },
                  thoughtSignature: 'sig_xyz',
                },
              ],
            },
          },
        ],
      })}\n\ndata: ${JSON.stringify({
        candidates: [{ finishReason: 'FUNCTION_CALL' }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 7, totalTokenCount: 10 },
      })}\n`;

      const encoder = new TextEncoder();
      let readCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: encoder.encode(sseData) };
          }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // Should have function call chunk and done chunk
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const fnChunk = chunks.find((c) => c.ok && c.value.toolCalls?.length);
      expect(fnChunk).toBeDefined();
      if (fnChunk?.ok) {
        expect(fnChunk.value.toolCalls![0].name).toBe('search');
        expect(JSON.parse(fnChunk.value.toolCalls![0].arguments)).toEqual({ query: 'weather' });
        expect(fnChunk.value.toolCalls![0].metadata).toEqual({ thoughtSignature: 'sig_xyz' });
      }

      const doneChunk = chunks.find((c) => c.ok && c.value.done === true);
      expect(doneChunk).toBeDefined();
      if (doneChunk?.ok) {
        expect(doneChunk.value.finishReason).toBe('tool_calls');
      }
    });

    it('handles thinking content in stream with metadata', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      const sseData = `data: ${JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: 'Thinking about this...', thought: true }],
            },
          },
        ],
      })}\n\ndata: ${JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: 'Final answer.' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10, totalTokenCount: 15 },
      })}\n`;

      const encoder = new TextEncoder();
      let readCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: encoder.encode(sseData) };
          }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // Thinking chunk should have metadata.type = 'thinking'
      const thinkingChunk = chunks.find((c) => c.ok && c.value.metadata?.type === 'thinking');
      expect(thinkingChunk).toBeDefined();
      if (thinkingChunk?.ok) {
        expect(thinkingChunk.value.content).toBe('Thinking about this...');
      }

      // Regular text chunk
      const textChunk = chunks.find((c) => c.ok && c.value.content === 'Final answer.');
      expect(textChunk).toBeDefined();
      if (textChunk?.ok) {
        expect(textChunk.value.metadata).toBeUndefined();
      }
    });

    it('yields error on non-ok response', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        body: null,
        text: async () => 'Service temporarily unavailable',
      });

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      const firstChunk = chunks[0];
      expect(firstChunk.ok).toBe(false);
      if (!firstChunk.ok) {
        expect(firstChunk.error.message).toContain('503');
      }
    });

    it('yields error on fetch exception', async () => {
      const provider = new GoogleProvider(makeMockConfig());
      mockFetch.mockRejectedValue(new Error('Network failure'));

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      const firstChunk = chunks[0];
      expect(firstChunk.ok).toBe(false);
      if (!firstChunk.ok) {
        expect(firstChunk.error.message).toContain('Network failure');
      }
    });

    it('uses correct streaming URL with alt=sse parameter', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      const mockReader = {
        read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        cancel: vi.fn(),
      };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': 'test-google-key',
          }),
        })
      );
    });

    it('skips malformed SSE data chunks', async () => {
      const provider = new GoogleProvider(makeMockConfig());

      const sseData = [
        'data: {invalid json}\n',
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'valid' }] } }],
        })}\n`,
        `data: ${JSON.stringify({
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        })}\n`,
      ].join('\n');

      const encoder = new TextEncoder();
      let readCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (readCount === 0) {
            readCount++;
            return { done: false, value: encoder.encode(sseData) };
          }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => mockReader },
      });

      const chunks: Result<StreamChunk>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // Should get valid text chunk + done chunk (malformed chunk silently skipped)
      const textChunks = chunks.filter((c) => c.ok && c.value.content);
      expect(textChunks).toHaveLength(1);
      const firstTextChunk = textChunks[0];
      if (firstTextChunk.ok) {
        expect(firstTextChunk.value.content).toBe('valid');
      }
    });
  });

  // ==================== type property ====================

  describe('type', () => {
    it('is google', () => {
      const provider = new GoogleProvider(makeMockConfig());
      expect(provider.type).toBe('google');
    });
  });
});
