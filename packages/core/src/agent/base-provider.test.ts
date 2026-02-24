/**
 * BaseProvider Tests
 *
 * Tests for the abstract base class shared by all AI providers:
 * timeout management, message building, tool formatting, token counting, cancel.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  AIProvider,
  ToolDefinition,
} from './types.js';
import type { Result } from '../types/result.js';
import type { InternalError, TimeoutError, ValidationError } from '../types/errors.js';
import { ok } from '../types/result.js';
import { BaseProvider, DEFAULT_RETRY_CONFIG } from './base-provider.js';

// ---------------------------------------------------------------------------
// Concrete subclass for testing the abstract BaseProvider
// ---------------------------------------------------------------------------

class TestProvider extends BaseProvider {
  readonly type: AIProvider = 'openai';

  isReady(): boolean {
    return !!this.config.apiKey;
  }

  async complete(
    _request: CompletionRequest
  ): Promise<Result<CompletionResponse, InternalError | TimeoutError | ValidationError>> {
    return ok({
      id: 'test',
      content: 'response',
      finishReason: 'stop',
      model: 'test-model',
      createdAt: new Date(),
    });
  }

  async *stream(
    _request: CompletionRequest
  ): AsyncGenerator<Result<StreamChunk, InternalError>, void, unknown> {
    yield ok({ id: '', content: 'chunk', done: true });
  }

  async getModels(): Promise<Result<string[], InternalError>> {
    return ok(['model-1']);
  }

  // Expose protected methods for testing
  public testCreateFetchOptions(body: unknown, timeoutMs?: number): RequestInit {
    return this.createFetchOptions(body, timeoutMs);
  }

  public testParseToolCalls(toolCalls: unknown) {
    return this.parseToolCalls(toolCalls);
  }

  public testBuildMessages(messages: readonly Message[]) {
    return this.buildMessages(messages);
  }

  public testBuildTools(request: CompletionRequest) {
    return this.buildTools(request);
  }

  public getAbortController() {
    return this.abortController;
  }

  public getRequestTimeoutId() {
    return this.requestTimeoutId;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseProvider', () => {
  let provider: TestProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new TestProvider({
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://api.example.com',
      timeout: 60000,
      organization: 'org-test',
      headers: { 'X-Custom': 'value' },
    });
  });

  afterEach(() => {
    provider.cancel();
    vi.useRealTimers();
  });

  // ==================== DEFAULT_RETRY_CONFIG ====================

  describe('DEFAULT_RETRY_CONFIG', () => {
    it('has expected default values', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(10000);
      expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
      expect(DEFAULT_RETRY_CONFIG.addJitter).toBe(true);
      expect(DEFAULT_RETRY_CONFIG.onRetry).toBeTypeOf('function');
    });
  });

  // ==================== countTokens ====================

  describe('countTokens', () => {
    it('counts tokens for string content messages', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello world' }, // 11 chars
        { role: 'assistant', content: 'Hi there' }, // 8 chars
      ];
      // 19 chars / 4 = 4.75 -> ceil = 5
      expect(provider.countTokens(messages)).toBe(5);
    });

    it('counts tokens for multipart text content', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' }, // 5 chars
            { type: 'text', text: 'World' }, // 5 chars
          ],
        },
      ];
      // 10 chars / 4 = 2.5 -> ceil = 3
      expect(provider.countTokens(messages)).toBe(3);
    });

    it('ignores non-text content parts (e.g., images)', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Look at this' }, // 12 chars
            { type: 'image', data: 'base64data', mediaType: 'image/png' as const },
          ],
        },
      ];
      // 12 chars / 4 = 3
      expect(provider.countTokens(messages)).toBe(3);
    });

    it('returns 0 for empty messages', () => {
      expect(provider.countTokens([])).toBe(0);
    });

    it('returns 1 for very short content', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hi' }];
      // 2 chars / 4 = 0.5 -> ceil = 1
      expect(provider.countTokens(messages)).toBe(1);
    });
  });

  // ==================== cancel ====================

  describe('cancel', () => {
    it('aborts the abort controller and clears it', () => {
      // Create a fetch options set to populate the abort controller
      provider.testCreateFetchOptions({ test: true });
      expect(provider.getAbortController()).not.toBeNull();

      provider.cancel();
      expect(provider.getAbortController()).toBeNull();
    });

    it('clears the request timeout', () => {
      provider.testCreateFetchOptions({ test: true });
      expect(provider.getRequestTimeoutId()).not.toBeNull();

      provider.cancel();
      expect(provider.getRequestTimeoutId()).toBeNull();
    });

    it('is safe to call when nothing is active', () => {
      expect(() => provider.cancel()).not.toThrow();
    });

    it('is safe to call multiple times', () => {
      provider.testCreateFetchOptions({ test: true });
      provider.cancel();
      provider.cancel();
      expect(provider.getAbortController()).toBeNull();
    });
  });

  // ==================== createFetchOptions ====================

  describe('createFetchOptions', () => {
    it('creates POST request with JSON content type', () => {
      const options = provider.testCreateFetchOptions({ key: 'value' });

      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('includes Authorization header when apiKey is set', () => {
      const options = provider.testCreateFetchOptions({});

      expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    });

    it('includes Organization header when organization is set', () => {
      const options = provider.testCreateFetchOptions({});

      expect((options.headers as Record<string, string>)['OpenAI-Organization']).toBe('org-test');
    });

    it('includes custom headers', () => {
      const options = provider.testCreateFetchOptions({});

      expect((options.headers as Record<string, string>)['X-Custom']).toBe('value');
    });

    it('omits Authorization header when no apiKey', () => {
      const noKeyProvider = new TestProvider({ provider: 'openai' });
      const options = noKeyProvider.testCreateFetchOptions({});

      expect((options.headers as Record<string, string>)['Authorization']).toBeUndefined();
    });

    it('omits Organization header when no organization', () => {
      const noOrgProvider = new TestProvider({ provider: 'openai', apiKey: 'key' });
      const options = noOrgProvider.testCreateFetchOptions({});

      expect((options.headers as Record<string, string>)['OpenAI-Organization']).toBeUndefined();
    });

    it('serializes body as JSON', () => {
      const body = { messages: [{ role: 'user' }] };
      const options = provider.testCreateFetchOptions(body);

      expect(options.body).toBe(JSON.stringify(body));
    });

    it('attaches an AbortSignal', () => {
      const options = provider.testCreateFetchOptions({});
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('uses provider timeout by default', () => {
      provider.testCreateFetchOptions({});
      // Provider timeout is 60000. After 60000ms, the abort should fire.
      expect(provider.getAbortController()).not.toBeNull();

      const controller = provider.getAbortController()!;
      expect(controller.signal.aborted).toBe(false);

      vi.advanceTimersByTime(60000);
      expect(controller.signal.aborted).toBe(true);
    });

    it('uses explicit timeout when provided', () => {
      provider.testCreateFetchOptions({}, 5000);
      const controller = provider.getAbortController()!;

      vi.advanceTimersByTime(4999);
      expect(controller.signal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(controller.signal.aborted).toBe(true);
    });

    it('uses 5-minute default timeout when no config timeout', () => {
      const defaultProvider = new TestProvider({ provider: 'openai', apiKey: 'key' });
      defaultProvider.testCreateFetchOptions({});
      const controller = defaultProvider.getAbortController()!;

      vi.advanceTimersByTime(299999);
      expect(controller.signal.aborted).toBe(false);

      vi.advanceTimersByTime(1);
      expect(controller.signal.aborted).toBe(true);

      defaultProvider.cancel();
    });

    it('clears previous timeout when called again', () => {
      provider.testCreateFetchOptions({}, 10000);
      const firstController = provider.getAbortController()!;

      // Create new options, should clear old timeout
      provider.testCreateFetchOptions({}, 20000);
      const secondController = provider.getAbortController()!;

      // Old timeout at 10s should not abort new controller
      vi.advanceTimersByTime(10000);
      expect(secondController.signal.aborted).toBe(false);

      // But new 20s timeout should
      vi.advanceTimersByTime(10000);
      expect(secondController.signal.aborted).toBe(true);

      // First controller was replaced, not aborted by timeout
      // (it was discarded when new one was created)
    });
  });

  // ==================== parseToolCalls ====================

  describe('parseToolCalls', () => {
    it('returns empty array for non-array input', () => {
      expect(provider.testParseToolCalls(null)).toEqual([]);
      expect(provider.testParseToolCalls(undefined)).toEqual([]);
      expect(provider.testParseToolCalls('string')).toEqual([]);
      expect(provider.testParseToolCalls(42)).toEqual([]);
    });

    it('parses OpenAI-format tool calls', () => {
      const toolCalls = [
        {
          id: 'call_1',
          function: { name: 'core__read_file', arguments: '{"path":"/tmp/f.txt"}' },
        },
      ];

      const result = provider.testParseToolCalls(toolCalls);

      expect(result).toEqual([
        {
          id: 'call_1',
          name: 'core.read_file', // desanitized
          arguments: '{"path":"/tmp/f.txt"}',
        },
      ]);
    });

    it('uses tc.name fallback when function.name is missing', () => {
      const toolCalls = [{ id: 'call_2', name: 'core__search', arguments: '{"q":"hello"}' }];

      const result = provider.testParseToolCalls(toolCalls);

      expect(result).toEqual([{ id: 'call_2', name: 'core.search', arguments: '{"q":"hello"}' }]);
    });

    it('defaults id to empty string when missing', () => {
      const toolCalls = [{ function: { name: 'test_tool', arguments: '{}' } }];
      const result = provider.testParseToolCalls(toolCalls);
      expect(result[0].id).toBe('');
    });

    it('defaults name to empty string when no name found', () => {
      const toolCalls = [{ id: 'x' }];
      const result = provider.testParseToolCalls(toolCalls);
      expect(result[0].name).toBe('');
    });

    it('defaults arguments to {} when missing', () => {
      const toolCalls = [{ id: 'x', function: { name: 'test' } }];
      const result = provider.testParseToolCalls(toolCalls);
      expect(result[0].arguments).toBe('{}');
    });

    it('parses multiple tool calls', () => {
      const toolCalls = [
        { id: 'a', function: { name: 'tool1', arguments: '{"x":1}' } },
        { id: 'b', function: { name: 'tool2', arguments: '{"y":2}' } },
      ];

      const result = provider.testParseToolCalls(toolCalls);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('tool1');
      expect(result[1].name).toBe('tool2');
    });
  });

  // ==================== buildMessages ====================

  describe('buildMessages', () => {
    it('builds simple string content messages', () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Hello' },
      ];

      const result = provider.testBuildMessages(messages);

      expect(result).toEqual([
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('builds messages with multipart text content', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Describe this' }],
        },
      ];

      const result = provider.testBuildMessages(messages);

      expect(result[0].content).toEqual([{ type: 'text', text: 'Describe this' }]);
    });

    it('converts image content with base64 data', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'image', data: 'abcdef', mediaType: 'image/png' as const }],
        },
      ];

      const result = provider.testBuildMessages(messages);
      const content = result[0].content as unknown[];

      expect(content[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,abcdef' },
      });
    });

    it('converts image content with URL data', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              data: 'https://example.com/img.png',
              mediaType: 'image/png' as const,
              isUrl: true,
            },
          ],
        },
      ];

      const result = provider.testBuildMessages(messages);
      const content = result[0].content as unknown[];

      expect(content[0]).toEqual({
        type: 'image_url',
        image_url: { url: 'https://example.com/img.png' },
      });
    });

    it('converts unsupported content types to fallback text', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'file' as any, name: 'doc.pdf', data: 'abc', mimeType: 'application/pdf' },
          ],
        },
      ];

      const result = provider.testBuildMessages(messages);
      const content = result[0].content as unknown[];

      expect(content[0]).toEqual({ type: 'text', text: '[Unsupported content]' });
    });

    it('expands tool result messages into separate messages per result', () => {
      const messages: Message[] = [
        {
          role: 'tool',
          content: '',
          toolResults: [
            { toolCallId: 'call_1', content: 'Result 1' },
            { toolCallId: 'call_2', content: 'Result 2' },
          ],
        },
      ];

      const result = provider.testBuildMessages(messages);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        role: 'tool',
        content: 'Result 1',
        tool_call_id: 'call_1',
      });
      expect(result[1]).toEqual({
        role: 'tool',
        content: 'Result 2',
        tool_call_id: 'call_2',
      });
    });

    it('includes tool_calls for assistant messages with tool calls', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: 'Let me help',
          toolCalls: [{ id: 'call_1', name: 'core.read_file', arguments: '{"path":"/tmp"}' }],
        },
      ];

      const result = provider.testBuildMessages(messages);

      expect(result[0].tool_calls).toEqual([
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'core__read_file', // sanitized
            arguments: '{"path":"/tmp"}',
          },
        },
      ]);
    });

    it('does not add tool_calls for user messages even if toolCalls present', () => {
      const messages: Message[] = [
        {
          role: 'user',
          content: 'Hello',
          toolCalls: [{ id: 'call_x', name: 'test', arguments: '{}' }],
        },
      ];

      const result = provider.testBuildMessages(messages);
      expect(result[0].tool_calls).toBeUndefined();
    });

    it('handles tool role message without toolResults (non-expanded path)', () => {
      const messages: Message[] = [{ role: 'tool', content: 'raw tool content' }];

      const result = provider.testBuildMessages(messages);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('tool');
      expect(result[0].content).toBe('raw tool content');
    });
  });

  // ==================== buildTools ====================

  describe('buildTools', () => {
    it('returns undefined when no tools', () => {
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'test' },
      };

      expect(provider.testBuildTools(request)).toBeUndefined();
    });

    it('returns undefined when tools array is empty', () => {
      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'test' },
        tools: [],
      };

      expect(provider.testBuildTools(request)).toBeUndefined();
    });

    it('formats tools with sanitized names', () => {
      const tool: ToolDefinition = {
        name: 'core.read_file',
        description: 'Read a file from disk',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      };

      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'test' },
        tools: [tool],
      };

      const result = provider.testBuildTools(request);

      expect(result).toEqual([
        {
          type: 'function',
          function: {
            name: 'core__read_file', // sanitized: dots -> double underscores
            description: 'Read a file from disk',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path' },
              },
              required: ['path'],
            },
          },
        },
      ]);
    });

    it('formats multiple tools', () => {
      const tools: ToolDefinition[] = [
        {
          name: 'tool_a',
          description: 'Tool A',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'plugin.weather.get_forecast',
          description: 'Tool B',
          parameters: { type: 'object', properties: {} },
        },
      ];

      const request: CompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        model: { model: 'test' },
        tools,
      };

      const result = provider.testBuildTools(request)!;

      expect(result).toHaveLength(2);
      expect(result[0].function.name).toBe('tool_a');
      expect(result[1].function.name).toBe('plugin__weather__get_forecast');
    });
  });
});
