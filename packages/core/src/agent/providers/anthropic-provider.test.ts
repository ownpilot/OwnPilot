/**
 * AnthropicProvider Tests
 *
 * Tests for the Anthropic/Claude API provider:
 * complete, stream, getModels, system block building, tool choice mapping,
 * stop reason mapping, message formatting (tool results, images, etc.).
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

import { AnthropicProvider } from './anthropic-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    model: { model: 'claude-3-5-sonnet-20241022' },
    ...overrides,
  };
}

function makeAnthropicResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_123',
    content: [{ type: 'text', text: 'Hello from Claude' }],
    model: 'claude-3-5-sonnet-20241022',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    provider = new AnthropicProvider({
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key',
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
      const p = new AnthropicProvider({ provider: 'anthropic', apiKey: 'key' });
      expect(p.type).toBe('anthropic');
    });

    it('uses custom baseUrl when provided', () => {
      const p = new AnthropicProvider({
        provider: 'anthropic',
        apiKey: 'key',
        baseUrl: 'https://custom.api.com/v1',
      });
      expect(p.type).toBe('anthropic');
    });
  });

  // ==================== isReady ====================

  describe('isReady', () => {
    it('returns true when apiKey is set', () => {
      expect(provider.isReady()).toBe(true);
    });

    it('returns false when apiKey is not set', () => {
      const p = new AnthropicProvider({ provider: 'anthropic' });
      expect(p.isReady()).toBe(false);
    });
  });

  // ==================== getModels ====================

  describe('getModels', () => {
    it('returns known Claude model list', async () => {
      const result = await provider.getModels();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('claude-3-5-sonnet-20241022');
        expect(result.value).toContain('claude-3-5-haiku-20241022');
        expect(result.value).toContain('claude-3-opus-20240229');
        expect(result.value.length).toBeGreaterThanOrEqual(5);
      }
    });
  });

  // ==================== complete ====================

  describe('complete', () => {
    it('returns ValidationError when not ready', async () => {
      const p = new AnthropicProvider({ provider: 'anthropic' });
      const result = await p.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('API key not configured');
      }
    });

    it('returns successful response with text content', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('Hello from Claude');
        expect(result.value.id).toBe('msg_123');
        expect(result.value.model).toBe('claude-3-5-sonnet-20241022');
        expect(result.value.finishReason).toBe('stop');
        expect(result.value.usage?.promptTokens).toBe(10);
        expect(result.value.usage?.completionTokens).toBe(20);
        expect(result.value.usage?.totalTokens).toBe(30);
      }
    });

    it('sends correct headers including anthropic-version and prompt caching', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(makeRequest());

      const fetchCall = mockFetch.mock.calls[0];
      const options = fetchCall[1];
      expect(options.headers['x-api-key']).toBe('sk-ant-test-key');
      expect(options.headers['anthropic-version']).toBe('2023-06-01');
      expect(options.headers['anthropic-beta']).toBe('prompt-caching-2024-07-31');
      expect(options.headers['Content-Type']).toBe('application/json');
    });

    it('sends request to correct endpoint', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(makeRequest());

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.anthropic.com/v1/messages');
    });

    it('extracts tool_use blocks from response', async () => {
      const response = makeAnthropicResponse({
        content: [
          { type: 'text', text: 'I will read the file' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'core__read_file',
            input: { path: '/tmp/test.txt' },
          },
        ],
        stop_reason: 'tool_use',
      });

      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('I will read the file');
        expect(result.value.toolCalls).toHaveLength(1);
        expect(result.value.toolCalls![0].id).toBe('toolu_1');
        expect(result.value.toolCalls![0].name).toBe('core.read_file'); // desanitized
        expect(result.value.toolCalls![0].arguments).toBe('{"path":"/tmp/test.txt"}');
        expect(result.value.finishReason).toBe('tool_calls');
      }
    });

    it('handles empty content blocks', async () => {
      const response = makeAnthropicResponse({ content: [] });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
        expect(result.value.toolCalls).toBeUndefined();
      }
    });

    it('handles missing content field in response', async () => {
      const response = makeAnthropicResponse({ content: undefined });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('');
      }
    });

    it('returns error for non-OK HTTP status', async () => {
      mockFetch.mockImplementation(mockFetchError(429, 'Rate limited'));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Anthropic API error');
        expect(result.error.message).toContain('429');
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
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Anthropic request failed');
        expect(result.error.message).toContain('Network error');
      }
    });

    it('extracts cached tokens from usage', async () => {
      const response = makeAnthropicResponse({
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80 },
      });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.usage?.cachedTokens).toBe(80);
      }
    });

    it('uses default maxTokens 4096 when not provided', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(makeRequest({ model: { model: 'claude-3-5-sonnet-20241022' } }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.max_tokens).toBe(4096);
    });

    it('separates system message from other messages', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [
            { role: 'system', content: 'You are a helper' },
            { role: 'user', content: 'Hello' },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toBeDefined();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
    });

    it('includes tools when provided', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'core.search',
          description: 'Search things',
          parameters: { type: 'object', properties: {} },
        },
      ];
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(makeRequest({ tools }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].name).toBe('core__search'); // sanitized
      expect(body.tools[0].input_schema).toBeDefined();
    });

    it('maps tool_choice auto correctly', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'tool_a',
          description: 'desc',
          parameters: { type: 'object', properties: {} },
        },
      ];
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(makeRequest({ tools, toolChoice: 'auto' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: 'auto' });
    });

    it('maps tool_choice none to omitted (undefined)', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'tool_a',
          description: 'desc',
          parameters: { type: 'object', properties: {} },
        },
      ];
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(makeRequest({ tools, toolChoice: 'none' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toBeUndefined();
    });

    it('maps tool_choice required to { type: any }', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'tool_a',
          description: 'desc',
          parameters: { type: 'object', properties: {} },
        },
      ];
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(makeRequest({ tools, toolChoice: 'required' }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: 'any' });
    });

    it('maps tool_choice with specific name', async () => {
      const tools: ToolDefinition[] = [
        {
          name: 'core.read_file',
          description: 'desc',
          parameters: { type: 'object', properties: {} },
        },
      ];
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(makeRequest({ tools, toolChoice: { name: 'core.read_file' } }));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: 'tool', name: 'core__read_file' });
    });

    it('maps stop_reason max_tokens to length', async () => {
      const response = makeAnthropicResponse({ stop_reason: 'max_tokens' });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.finishReason).toBe('length');
      }
    });

    it('maps unknown stop_reason to stop', async () => {
      const response = makeAnthropicResponse({ stop_reason: 'something_else' });
      mockFetch.mockImplementation(mockFetchOk(response));

      const result = await provider.complete(makeRequest());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.finishReason).toBe('stop');
      }
    });
  });

  // ==================== complete - Anthropic message building ====================

  describe('complete - message building', () => {
    it('handles tool result messages (role=tool with toolResults)', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [
            { role: 'user', content: 'Use the tool' },
            {
              role: 'assistant',
              content: 'I will use the tool',
              toolCalls: [{ id: 'call_1', name: 'core.read_file', arguments: '{"path":"/tmp"}' }],
            },
            {
              role: 'tool',
              content: '',
              toolResults: [{ toolCallId: 'call_1', content: 'file content here' }],
            },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Tool results should be user role with tool_result type
      const toolResultMsg = body.messages.find(
        (m: any) =>
          m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result'
      );
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content[0].tool_use_id).toBe('call_1');
      expect(toolResultMsg.content[0].content).toBe('file content here');
    });

    it('handles assistant messages with tool_use in content array', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [
            {
              role: 'assistant',
              content: 'Let me check',
              toolCalls: [{ id: 'tc_1', name: 'core.search', arguments: '{"q":"test"}' }],
            },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const assistantMsg = body.messages[0];
      expect(assistantMsg.role).toBe('assistant');
      // Content should be an array with text + tool_use blocks
      expect(Array.isArray(assistantMsg.content)).toBe(true);
      const toolUseBlock = assistantMsg.content.find((b: any) => b.type === 'tool_use');
      expect(toolUseBlock).toBeDefined();
      expect(toolUseBlock.name).toBe('core__search'); // sanitized
      expect(toolUseBlock.input).toEqual({ q: 'test' });
    });

    it('handles assistant messages with malformed tool call arguments', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [
            {
              role: 'assistant',
              content: 'Using tool',
              toolCalls: [{ id: 'tc_1', name: 'test', arguments: 'not valid json' }],
            },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Should not throw, input should default to {}
      const toolUseBlock = body.messages[0].content.find((b: any) => b.type === 'tool_use');
      expect(toolUseBlock.input).toEqual({});
    });

    it('handles image content with base64', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'What is this?' },
                { type: 'image', data: 'abc123', mediaType: 'image/jpeg' as const },
              ],
            },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const content = body.messages[0].content;
      expect(content[0]).toEqual({ type: 'text', text: 'What is this?' });
      expect(content[1]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' },
      });
    });

    it('handles image content with URL', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [
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
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const imgBlock = body.messages[0].content[0];
      expect(imgBlock).toEqual({
        type: 'image',
        source: { type: 'url', url: 'https://example.com/img.png' },
      });
    });

    it('converts empty string content to empty content array', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [{ role: 'user', content: '' }],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Empty string -> contentParts = [] (no text block generated)
      expect(body.messages[0].content).toEqual([]);
    });

    it('uses simple string for single text-only messages', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [{ role: 'user', content: 'Hello world' }],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toBe('Hello world');
    });
  });

  // ==================== complete - system blocks ====================

  describe('complete - system blocks with caching', () => {
    it('caches static part and does not cache dynamic part', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      const systemPrompt =
        'You are a helpful assistant.\n\n## Current Context\nThe user is in a chat.';

      await provider.complete(
        makeRequest({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Hi' },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toHaveLength(2);
      // Static part gets cache_control
      expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(body.system[0].text).toContain('You are a helpful assistant');
      // Dynamic part does NOT get cache_control
      expect(body.system[1].cache_control).toBeUndefined();
      expect(body.system[1].text).toContain('Current Context');
    });

    it('only returns static block when no dynamic markers', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [
            { role: 'system', content: 'You are a helper with tools.' },
            { role: 'user', content: 'Hi' },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toHaveLength(1);
      expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('handles multipart system message content', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      await provider.complete(
        makeRequest({
          messages: [
            {
              role: 'system',
              content: [
                { type: 'text', text: 'Part 1' },
                { type: 'text', text: 'Part 2' },
              ],
            },
            { role: 'user', content: 'Hi' },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toBeDefined();
      expect(body.system[0].text).toContain('Part 1');
      expect(body.system[0].text).toContain('Part 2');
    });

    it('splits on Code Execution marker', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      const systemPrompt = 'Static instructions\n\n## Code Execution\nDynamic stuff';

      await provider.complete(
        makeRequest({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Hi' },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toHaveLength(2);
      expect(body.system[0].text).toBe('Static instructions');
      expect(body.system[1].text).toContain('Code Execution');
    });

    it('splits on File Operations marker', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      const systemPrompt = 'Base prompt\n\n## File Operations\nFiles here';

      await provider.complete(
        makeRequest({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Hi' },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toHaveLength(2);
    });

    it('picks the earliest dynamic marker as split point', async () => {
      mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

      const systemPrompt = 'Static\n\n## Current Context\nCtx\n\n## Code Execution\nExec';

      await provider.complete(
        makeRequest({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: 'Hi' },
          ],
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.system).toHaveLength(2);
      expect(body.system[0].text).toBe('Static');
      expect(body.system[1].text).toContain('Current Context');
      expect(body.system[1].text).toContain('Code Execution');
    });
  });

  // ==================== stream ====================

  describe('stream', () => {
    it('yields error when not ready', async () => {
      const p = new AnthropicProvider({ provider: 'anthropic' });
      const gen = p.stream(makeRequest());
      const first = await gen.next();

      expect(first.value).toBeDefined();
      expect(first.value!.ok).toBe(false);
      if (!first.value!.ok) {
        expect(first.value!.error.message).toContain('API key not configured');
      }
    });

    it('yields error on non-OK HTTP response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        body: null,
        text: () => Promise.resolve('Server error'),
      });

      const gen = provider.stream(makeRequest());
      const first = await gen.next();

      expect(first.value!.ok).toBe(false);
      if (!first.value!.ok) {
        expect(first.value!.error.message).toContain('Anthropic stream error: 500');
      }
    });

    it('yields error when response body is null', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
        text: () => Promise.resolve(''),
      });

      const gen = provider.stream(makeRequest());
      const first = await gen.next();

      expect(first.value!.ok).toBe(false);
    });

    it('streams text content deltas', async () => {
      const sseChunks = [
        'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":15}}}\n\n',
        'data: {"type":"content_block_start","content_block":{"type":"text"},"index":0}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks: Result<StreamChunk, InternalError>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // Should have: text delta "Hello ", text delta "world", message_delta, message_stop
      const textChunks = chunks.filter((c) => c.ok && (c as any).value.content);
      expect(textChunks.length).toBeGreaterThanOrEqual(2);

      // Last chunk should be done=true
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.ok).toBe(true);
      if (lastChunk.ok) {
        expect(lastChunk.value.done).toBe(true);
      }
    });

    it('streams tool call arguments via input_json_delta', async () => {
      const sseChunks = [
        'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10}}}\n\n',
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_1","name":"core__search"},"index":0}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"q\\""},"index":0}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":":\\"hello\\"}"},"index":0}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks: Result<StreamChunk, InternalError>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // The final message_stop chunk should have tool calls
      const doneChunk = chunks.find((c) => c.ok && (c as any).value.done === true);
      expect(doneChunk).toBeDefined();
      if (doneChunk && doneChunk.ok) {
        expect(doneChunk.value.toolCalls).toBeDefined();
        expect(doneChunk.value.toolCalls).toHaveLength(1);
        expect(doneChunk.value.toolCalls![0].id).toBe('toolu_1');
        expect(doneChunk.value.toolCalls![0].name).toBe('core.search'); // desanitized
      }
    });

    it('captures input tokens from message_start', async () => {
      const sseChunks = [
        'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":42}}}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks: Result<StreamChunk, InternalError>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // message_delta chunk should have usage with input tokens from message_start
      const deltaChunk = chunks.find((c) => c.ok && (c as any).value.usage?.promptTokens === 42);
      expect(deltaChunk).toBeDefined();
      if (deltaChunk && deltaChunk.ok) {
        expect(deltaChunk.value.usage!.completionTokens).toBe(7);
        expect(deltaChunk.value.usage!.totalTokens).toBe(49);
      }
    });

    it('skips malformed SSE data gracefully', async () => {
      const sseChunks = [
        'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":5}}}\n\n',
        'data: NOT VALID JSON\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"OK"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks: Result<StreamChunk, InternalError>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // Should get text delta and done without error
      const okChunks = chunks.filter((c) => c.ok);
      expect(okChunks.length).toBeGreaterThanOrEqual(2);
    });

    it('ignores non-data lines', async () => {
      const sseChunks = [
        'event: message_start\n',
        'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":5}}}\n\n',
        ':comment line\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks: Result<StreamChunk, InternalError>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('yields error when fetch throws', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'));

      const chunks: Result<StreamChunk, InternalError>[] = [];
      for await (const chunk of provider.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].ok).toBe(false);
      if (!chunks[0].ok) {
        expect(chunks[0].error.message).toContain('Anthropic stream failed');
      }
    });

    it('does not include tools/tool_choice when no tools in request', async () => {
      const sseChunks = [
        'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":5}}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];
      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      await collectStream(provider.stream(makeRequest()));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
    });

    it('handles message_stop with no tool calls (empty filter result)', async () => {
      const sseChunks = [
        'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":5}}}\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      mockFetch.mockImplementation(mockFetchStream(sseChunks));

      const chunks = await collectStream(provider.stream(makeRequest()));

      const doneChunk = chunks.find((c) => c.ok && (c as any).value.done === true);
      expect(doneChunk).toBeDefined();
      if (doneChunk && doneChunk.ok) {
        expect(doneChunk.value.toolCalls).toBeUndefined();
      }
    });
  });

  // ==================== Thinking Support ====================

  describe('thinking support', () => {
    describe('complete - thinking response', () => {
      it('extracts thinking content from non-streaming response', async () => {
        const response = makeAnthropicResponse({
          content: [
            { type: 'thinking', thinking: 'Let me reason about this...', signature: 'sig_abc' },
            { type: 'text', text: 'Here is my answer.' },
          ],
        });
        mockFetch.mockImplementation(mockFetchOk(response));

        const result = await provider.complete(makeRequest({ thinking: { type: 'adaptive' } }));

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.content).toBe('Here is my answer.');
          expect(result.value.thinkingContent).toBe('Let me reason about this...');
          expect(result.value.thinkingBlocks).toHaveLength(1);
          expect(result.value.thinkingBlocks![0]).toEqual({
            type: 'thinking',
            thinking: 'Let me reason about this...',
            signature: 'sig_abc',
          });
        }
      });

      it('handles redacted_thinking blocks', async () => {
        const response = makeAnthropicResponse({
          content: [
            { type: 'thinking', thinking: 'Visible thought', signature: 'sig_1' },
            { type: 'redacted_thinking', data: 'encrypted_data_here' },
            { type: 'text', text: 'Answer.' },
          ],
        });
        mockFetch.mockImplementation(mockFetchOk(response));

        const result = await provider.complete(makeRequest({ thinking: { type: 'adaptive' } }));

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.thinkingBlocks).toHaveLength(2);
          expect(result.value.thinkingBlocks![0]).toEqual({
            type: 'thinking',
            thinking: 'Visible thought',
            signature: 'sig_1',
          });
          expect(result.value.thinkingBlocks![1]).toEqual({
            type: 'redacted_thinking',
            data: 'encrypted_data_here',
          });
        }
      });

      it('omits temperature when thinking is enabled', async () => {
        mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

        await provider.complete(
          makeRequest({
            thinking: { type: 'adaptive' },
            model: { model: 'claude-3-5-sonnet-20241022', temperature: 0.7 },
          })
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.temperature).toBeUndefined();
        expect(body.thinking).toBeDefined();
      });

      it('sends adaptive thinking param correctly', async () => {
        mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

        await provider.complete(makeRequest({ thinking: { type: 'adaptive' } }));

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.thinking).toEqual({ type: 'adaptive' });
      });

      it('sends manual thinking param with budget_tokens', async () => {
        mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

        await provider.complete(
          makeRequest({ thinking: { type: 'enabled', budgetTokens: 16000 } })
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16000 });
      });

      it('restricts tool_choice to auto when thinking is enabled', async () => {
        const tools: ToolDefinition[] = [
          { name: 'test', description: 'desc', parameters: { type: 'object', properties: {} } },
        ];
        mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

        await provider.complete(
          makeRequest({
            thinking: { type: 'adaptive' },
            tools,
            toolChoice: 'required',
          })
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        // tool_choice 'required' should fall back to 'auto' when thinking is enabled
        expect(body.tool_choice).toEqual({ type: 'auto' });
      });
    });

    describe('stream - thinking deltas', () => {
      it('yields thinking content with metadata type thinking', async () => {
        const sseChunks = [
          'data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10}}}\n\n',
          'data: {"type":"content_block_start","content_block":{"type":"thinking"},"index":0}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Let me think"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"... more thought"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"signature_delta","signature":"sig_123"}}\n\n',
          'data: {"type":"content_block_stop","index":0}\n\n',
          'data: {"type":"content_block_start","content_block":{"type":"text"},"index":1}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"My answer"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}\n\n',
          'data: {"type":"message_stop"}\n\n',
        ];

        mockFetch.mockImplementation(mockFetchStream(sseChunks));

        const chunks = await collectStream(
          provider.stream(makeRequest({ thinking: { type: 'adaptive' } }))
        );

        // Find thinking chunks (metadata.type === 'thinking')
        const thinkingChunks = chunks.filter(
          (c) => c.ok && (c as any).value.metadata?.type === 'thinking'
        );
        expect(thinkingChunks.length).toBeGreaterThanOrEqual(2);

        // Verify thinking content
        const thinkingTexts = thinkingChunks
          .filter((c) => c.ok)
          .map((c) => (c as any).value.content);
        expect(thinkingTexts).toContain('Let me think');
        expect(thinkingTexts).toContain('... more thought');

        // Find text chunks (no thinking metadata)
        const textChunks = chunks.filter(
          (c) => c.ok && (c as any).value.content && !(c as any).value.metadata?.type
        );
        expect(textChunks.length).toBeGreaterThanOrEqual(1);

        // Done chunk should have thinkingBlocks in metadata
        const doneChunk = chunks.find((c) => c.ok && (c as any).value.done === true);
        expect(doneChunk).toBeDefined();
        if (doneChunk && doneChunk.ok) {
          const blocks = doneChunk.value.metadata?.thinkingBlocks as Record<string, unknown>[];
          expect(blocks).toBeDefined();
          expect(blocks.length).toBeGreaterThanOrEqual(1);
          expect(blocks[0].type).toBe('thinking');
          expect(blocks[0].thinking).toBe('Let me think... more thought');
          expect(blocks[0].signature).toBe('sig_123');
        }
      });
    });

    describe('message history - thinking block preservation', () => {
      it('includes thinking blocks from metadata in assistant messages', async () => {
        mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

        await provider.complete(
          makeRequest({
            messages: [
              { role: 'user', content: 'Hello' },
              {
                role: 'assistant',
                content: 'Response',
                metadata: {
                  thinkingBlocks: [
                    { type: 'thinking', thinking: 'My reasoning...', signature: 'sig_abc' },
                  ],
                },
              },
              { role: 'user', content: 'Follow up' },
            ],
          })
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
        expect(assistantMsg).toBeDefined();
        expect(Array.isArray(assistantMsg.content)).toBe(true);

        // Should have thinking block first, then text
        const thinkingBlock = assistantMsg.content.find((b: any) => b.type === 'thinking');
        expect(thinkingBlock).toBeDefined();
        expect(thinkingBlock.thinking).toBe('My reasoning...');
        expect(thinkingBlock.signature).toBe('sig_abc');
      });

      it('preserves redacted_thinking blocks in message history', async () => {
        mockFetch.mockImplementation(mockFetchOk(makeAnthropicResponse()));

        await provider.complete(
          makeRequest({
            messages: [
              { role: 'user', content: 'Hello' },
              {
                role: 'assistant',
                content: 'Response',
                metadata: {
                  thinkingBlocks: [{ type: 'redacted_thinking', data: 'encrypted_data' }],
                },
              },
              { role: 'user', content: 'Follow up' },
            ],
          })
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        const assistantMsg = body.messages.find((m: any) => m.role === 'assistant');
        const redactedBlock = assistantMsg.content.find((b: any) => b.type === 'redacted_thinking');
        expect(redactedBlock).toBeDefined();
        expect(redactedBlock.data).toBe('encrypted_data');
      });
    });
  });

  // ==================== countTokens (inherited from BaseProvider) ====================

  describe('countTokens', () => {
    it('approximates token count for simple messages', () => {
      const messages: Message[] = [{ role: 'user', content: 'Hello world!!!' }]; // 14 chars
      expect(provider.countTokens(messages)).toBe(4); // ceil(14/4) = 4
    });
  });
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

async function collectStream<T>(gen: AsyncGenerator<T, void, unknown>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}
