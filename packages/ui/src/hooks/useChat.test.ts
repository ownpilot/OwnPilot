import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── React mock infrastructure ──────────────────────────────────────────────

let stateIndex = 0;
const states: Array<{ value: unknown; setter: (v: unknown) => void }> = [];
const refs: Array<{ current: unknown }> = [];
let effectCleanups: Array<() => void> = [];
let refIndex = 0;

function resetReactMocks() {
  stateIndex = 0;
  refIndex = 0;
  states.length = 0;
  refs.length = 0;
  effectCleanups.forEach((fn) => fn());
  effectCleanups = [];
}

vi.mock('react', () => ({
  useState: (initial: unknown) => {
    if (stateIndex >= states.length) {
      const slot = { value: initial, setter: (_v: unknown) => {} };
      slot.setter = (v: unknown) => {
        slot.value = typeof v === 'function' ? (v as (prev: unknown) => unknown)(slot.value) : v;
      };
      states.push(slot);
    }
    const slot = states[stateIndex]!;
    stateIndex++;
    return [slot.value, slot.setter];
  },
  useCallback: (fn: (...args: unknown[]) => unknown, _deps?: unknown[]) => fn,
  useRef: (initial: unknown) => {
    if (refIndex >= refs.length) {
      refs.push({ current: initial });
    }
    const ref = refs[refIndex]!;
    refIndex++;
    return ref;
  },
  useEffect: (fn: () => (() => void) | void, _deps?: unknown[]) => {
    const cleanup = fn();
    if (cleanup) effectCleanups.push(cleanup);
  },
}));

// ─── Global stubs ───────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${uuidCounter++}`,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function createSSEResponse(events: Array<{ data: string }>): Response {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(`data: ${e.data}\n\n`));
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!);
        index++;
      } else {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createErrorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// State slot indices matching useState call order in useChat.ts
const S = {
  messages: 0,
  isLoading: 1,
  error: 2,
  lastFailedMessage: 3,
  provider: 4,
  model: 5,
  agentId: 6,
  workspaceId: 7,
  streamingContent: 8,
  progressEvents: 9,
} as const;

// Import useChat lazily after mocks are set up
async function importUseChat() {
  const mod = await import('./useChat');
  return mod.useChat;
}

let useChat: Awaited<ReturnType<typeof importUseChat>>;

// ─── Setup / Teardown ───────────────────────────────────────────────────────

beforeEach(async () => {
  resetReactMocks();
  mockFetch.mockReset();
  uuidCounter = 0;
  useChat = await importUseChat();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Call the hook, simulating a React render.
 * Resets stateIndex and refIndex so existing slots are reused on re-render.
 */
function callHook(options?: {
  provider?: string;
  model?: string;
  agentId?: string;
  workspaceId?: string;
  onProgress?: (event: unknown) => void;
}) {
  stateIndex = 0;
  refIndex = 0;
  return useChat(options);
}

/**
 * Initialize the hook's state slots, then allow the caller to mutate them
 * before a second callHook() re-render picks up the mutated values.
 */
function initHook(options?: Parameters<typeof callHook>[0]) {
  callHook(options); // first render — creates all state slots and refs
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useChat', () => {
  // ── 1. Initial state ────────────────────────────────────────────────────

  describe('initial state', () => {
    it('returns correct default state', () => {
      const result = callHook();
      expect(result.messages).toEqual([]);
      expect(result.isLoading).toBe(false);
      expect(result.error).toBeNull();
      expect(result.lastFailedMessage).toBeNull();
      expect(result.streamingContent).toBe('');
      expect(result.progressEvents).toEqual([]);
    });

    it('uses options.provider and model if provided', () => {
      const result = callHook({ provider: 'openai', model: 'gpt-4' });
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4');
    });

    it('defaults provider and model to empty strings', () => {
      const result = callHook();
      expect(result.provider).toBe('');
      expect(result.model).toBe('');
    });

    it('uses options.agentId and workspaceId if provided', () => {
      const result = callHook({ agentId: 'agent-1', workspaceId: 'ws-1' });
      expect(result.agentId).toBe('agent-1');
      expect(result.workspaceId).toBe('ws-1');
    });

    it('defaults agentId and workspaceId to null', () => {
      const result = callHook();
      expect(result.agentId).toBeNull();
      expect(result.workspaceId).toBeNull();
    });

    it('returns all expected functions', () => {
      const result = callHook();
      expect(typeof result.sendMessage).toBe('function');
      expect(typeof result.retryLastMessage).toBe('function');
      expect(typeof result.clearMessages).toBe('function');
      expect(typeof result.cancelRequest).toBe('function');
      expect(typeof result.setProvider).toBe('function');
      expect(typeof result.setModel).toBe('function');
      expect(typeof result.setAgentId).toBe('function');
      expect(typeof result.setWorkspaceId).toBe('function');
    });
  });

  // ── 2. sendMessage — request construction ──────────────────────────────

  describe('sendMessage — request construction', () => {
    it('sends POST to /api/v1/chat with correct body', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Hello', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('Hi');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe('/api/v1/chat');
      expect(opts.method).toBe('POST');
      expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(opts.body);
      expect(body.message).toBe('Hi');
      expect(body.stream).toBe(true);
    });

    it('includes provider and model in request body', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      const result = callHook({ provider: 'anthropic', model: 'claude-3' });
      await result.sendMessage('test');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.provider).toBe('anthropic');
      expect(body.model).toBe('claude-3');
    });

    it('includes agentId when set', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      const result = callHook({ agentId: 'agent-42' });
      await result.sendMessage('test');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.agentId).toBe('agent-42');
    });

    it('includes workspaceId when set', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      const result = callHook({ workspaceId: 'ws-99' });
      await result.sendMessage('test');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.workspaceId).toBe('ws-99');
    });

    it('excludes agentId and workspaceId when not set', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('test');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.agentId).toBeUndefined();
      expect(body.workspaceId).toBeUndefined();
    });

    it('includes message history filtered and sliced', async () => {
      // First render to populate state slots
      initHook();

      // Pre-populate messages state with a mix of normal and error messages
      const existingMessages = [
        { id: '1', role: 'user', content: 'msg1', timestamp: '2024-01-01' },
        { id: '2', role: 'assistant', content: 'resp1', timestamp: '2024-01-01' },
        { id: '3', role: 'assistant', content: 'error!', timestamp: '2024-01-01', isError: true },
      ];
      states[S.messages]!.value = existingMessages;

      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      // Re-invoke hook to pick up the updated messages reference
      const result = callHook();
      await result.sendMessage('new msg');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      // history should exclude isError messages
      expect(body.history).toEqual([
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'resp1' },
      ]);
    });

    it('sends stream: true in request body', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('test');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.stream).toBe(true);
    });
  });

  // ── 3. sendMessage — state updates ─────────────────────────────────────

  describe('sendMessage — state updates', () => {
    it('sets isLoading to true during request', async () => {
      let loadingDuringFetch = false;
      mockFetch.mockImplementationOnce(() => {
        loadingDuringFetch = states[S.isLoading]!.value as boolean;
        return Promise.resolve(createJsonResponse({
          success: true,
          data: { response: 'Ok', conversationId: 'conv-1' },
        }));
      });

      const result = callHook();
      await result.sendMessage('test');

      expect(loadingDuringFetch).toBe(true);
    });

    it('clears error on new message', async () => {
      // First render to create state slots
      initHook();
      states[S.error]!.value = 'previous error';

      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBeNull();
    });

    it('adds user message to messages array', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('Hello world');

      const messages = states[S.messages]!.value as Array<{ role: string; content: string }>;
      // First message should be the user message
      expect(messages[0]).toMatchObject({
        role: 'user',
        content: 'Hello world',
      });
    });

    it('sets isLoading false after completion', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.isLoading]!.value).toBe(false);
    });
  });

  // ── 4. SSE streaming response ──────────────────────────────────────────

  describe('SSE streaming response', () => {
    it('accumulates delta chunks into streamingContent', async () => {
      const sseResponse = createSSEResponse([
        { data: JSON.stringify({ delta: 'Hello ' }) },
        { data: JSON.stringify({ delta: 'world' }) },
        { data: JSON.stringify({ delta: '!', done: true, id: '1', conversationId: 'c1' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook();
      await result.sendMessage('hi');

      // After streaming completes, streamingContent is cleared
      expect(states[S.streamingContent]!.value).toBe('');

      // But the final assistant message should contain the accumulated content
      const messages = states[S.messages]!.value as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('Hello world!');
    });

    it('handles done event and creates final response', async () => {
      const sseResponse = createSSEResponse([
        { data: JSON.stringify({ delta: 'Complete answer' }) },
        {
          data: JSON.stringify({
            delta: '',
            done: true,
            id: 'msg-1',
            conversationId: 'conv-1',
            toolCalls: [{ id: 'tc1', name: 'search', arguments: {} }],
            usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
            finishReason: 'stop',
          }),
        },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe('Complete answer');
      expect(assistantMsg!.toolCalls).toEqual([{ id: 'tc1', name: 'search', arguments: {} }]);
    });

    it('creates assistant message from accumulated content', async () => {
      const sseResponse = createSSEResponse([
        { data: JSON.stringify({ delta: 'Part 1. ' }) },
        { data: JSON.stringify({ delta: 'Part 2.' }) },
        { data: JSON.stringify({ delta: '', done: true, id: '1', conversationId: 'c1' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook({ provider: 'openai', model: 'gpt-4' });
      await result.sendMessage('question');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toMatchObject({
        role: 'assistant',
        content: 'Part 1. Part 2.',
        provider: 'openai',
      });
    });

    it('handles progress events (tool_start, tool_end, status)', async () => {
      const progressToolStart = {
        type: 'tool_start',
        tool: { id: 't1', name: 'search', arguments: { q: 'test' } },
        timestamp: '2024-01-01T00:00:00Z',
      };
      const progressToolEnd = {
        type: 'tool_end',
        result: { success: true, preview: 'found', durationMs: 100 },
        timestamp: '2024-01-01T00:00:01Z',
      };
      const progressStatus = {
        type: 'status',
        message: 'Thinking...',
        timestamp: '2024-01-01T00:00:02Z',
      };

      const sseResponse = createSSEResponse([
        { data: JSON.stringify(progressToolStart) },
        { data: JSON.stringify(progressToolEnd) },
        { data: JSON.stringify(progressStatus) },
        { data: JSON.stringify({ delta: 'result', done: true, id: '1', conversationId: 'c1' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook();
      await result.sendMessage('test');

      // Progress events were added during streaming; cleared in finally block
      // The finally block calls setProgressEvents([])
      expect(states[S.progressEvents]!.value).toEqual([]);
    });

    it('calls onProgress callback for progress events', async () => {
      const onProgress = vi.fn();

      const progressEvent = {
        type: 'tool_start',
        tool: { id: 't1', name: 'search' },
        timestamp: '2024-01-01T00:00:00Z',
      };

      const sseResponse = createSSEResponse([
        { data: JSON.stringify(progressEvent) },
        { data: JSON.stringify({ delta: 'ok', done: true, id: '1', conversationId: 'c1' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook({ onProgress });
      await result.sendMessage('test');

      expect(onProgress).toHaveBeenCalledWith(progressEvent);
    });

    it('handles error event in stream (propagates to outer catch)', async () => {
      // Error events from the server now propagate to the outer catch block
      // and set proper error state (previously they were silently swallowed).
      const sseResponse = createSSEResponse([
        { data: JSON.stringify({ error: 'Token limit exceeded' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook();
      await result.sendMessage('test');

      // Error state is set
      expect(states[S.error]!.value).toBe('Token limit exceeded');
      // An error message is created
      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const errorMsg = messages.find((m) => m.role === 'assistant' && m.isError);
      expect(errorMsg).toBeDefined();
    });

    it('clears streamingContent after stream completes', async () => {
      const sseResponse = createSSEResponse([
        { data: JSON.stringify({ delta: 'content' }) },
        { data: JSON.stringify({ delta: '', done: true, id: '1', conversationId: 'c1' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.streamingContent]!.value).toBe('');
    });

    it('handles empty delta (falsy data.delta)', async () => {
      const sseResponse = createSSEResponse([
        { data: JSON.stringify({ delta: 'real content' }) },
        { data: JSON.stringify({ delta: '' }) },
        { data: JSON.stringify({ delta: null }) },
        { data: JSON.stringify({ delta: ' more', done: true, id: '1', conversationId: 'c1' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      // Empty/null deltas should be skipped, only 'real content' and ' more' accumulated
      expect(assistantMsg?.content).toBe('real content more');
    });

    it('handles multi-chunk SSE data in a single read', async () => {
      // Simulate two events arriving in a single chunk
      const encoder = new TextEncoder();
      const combined = encoder.encode(
        `data: ${JSON.stringify({ delta: 'Hello ' })}\n\ndata: ${JSON.stringify({ delta: 'World', done: true, id: '1', conversationId: 'c1' })}\n\n`
      );

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(combined);
          controller.close();
        },
      });

      const response = new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      mockFetch.mockResolvedValueOnce(response);

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('Hello World');
    });
  });

  // ── 5. Non-streaming JSON response ─────────────────────────────────────

  describe('non-streaming JSON response', () => {
    it('parses JSON response correctly', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          response: 'JSON answer',
          conversationId: 'conv-1',
          model: 'gpt-4-turbo',
          toolCalls: [],
        },
      }));

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toBe('JSON answer');
    });

    it('creates assistant message from data.data.response', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          response: 'The answer is 42',
          conversationId: 'conv-1',
          model: 'claude-3',
          trace: { duration: 500 },
        },
      }));

      const result = callHook({ provider: 'anthropic', model: 'claude-3' });
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toMatchObject({
        role: 'assistant',
        content: 'The answer is 42',
        provider: 'anthropic',
        model: 'claude-3',
      });
      expect(assistantMsg!.trace).toEqual({ duration: 500 });
    });

    it('handles unsuccessful API response (success=false) with error message', async () => {
      // When success=false and error.message exists, the thrown error uses error.message
      // because: `throw new Error(data.error?.message ?? 'Failed to get response')`
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: false,
        error: { message: 'Rate limited', code: 'RATE_LIMIT' },
      }));

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBe('Rate limited');
      expect(states[S.lastFailedMessage]!.value).toBe('test');
    });

    it('handles unsuccessful API response (success=false) without error message', async () => {
      // When success=false and no error.message, falls back to 'Failed to get response'
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: false,
      }));

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBe('Failed to get response');
    });
  });

  // ── 6. Error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('HTTP error response sets error state', async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(500, 'Internal server error'));

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBe('Internal server error');
    });

    it('network error sets error state', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBe('Failed to fetch');
    });

    it('sets lastFailedMessage on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network down'));

      const result = callHook();
      await result.sendMessage('save this message');

      expect(states[S.lastFailedMessage]!.value).toBe('save this message');
    });

    it('adds error message to messages array', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Something broke'));

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const errorMsg = messages.find((m) => m.isError === true);
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.role).toBe('assistant');
      expect(errorMsg!.content).toContain('Something broke');
    });

    it('AbortError is silently ignored (no error state)', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBeNull();
    });

    it('preserves partial streaming content with error note on stream failure', async () => {
      // To get partial content into the outer catch, we need the stream reader
      // itself to throw (not the inner SSE parse catch). Use a stream that
      // delivers content then errors at the reader level.
      const encoder = new TextEncoder();
      let readCount = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          readCount++;
          if (readCount === 1) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: 'Partial content so far' })}\n\n`)
            );
          } else {
            // This causes the reader to throw, reaching the outer catch
            controller.error(new Error('Stream broken'));
          }
        },
      });

      const response = new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      mockFetch.mockResolvedValueOnce(response);

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const errorMsg = messages.find((m) => m.isError === true);
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.content).toContain('Partial content so far');
      expect(errorMsg!.content).toContain('Response interrupted');
    });

    it('HTTP error without error message falls back to status code', async () => {
      // Response with no error.message field
      const response = new Response(JSON.stringify({}), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
      mockFetch.mockResolvedValueOnce(response);

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBe('HTTP error 503');
    });

    it('non-Error thrown objects produce generic error message', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBe('An error occurred');
    });

    it('error without partial content creates standard error message', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Server exploded'));

      const result = callHook();
      await result.sendMessage('boom');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const errorMsg = messages.find((m) => m.isError === true);
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.content).toBe('Sorry, I encountered an error: Server exploded');
      // Should not contain partial content marker
      expect(errorMsg!.content).not.toContain('Response interrupted');
    });
  });

  // ── 7. Cancel request ──────────────────────────────────────────────────

  describe('cancelRequest', () => {
    it('aborts the current controller', async () => {
      let fetchResolve: (v: Response) => void;
      mockFetch.mockImplementationOnce(
        () => new Promise<Response>((resolve) => { fetchResolve = resolve; })
      );

      const result = callHook();
      // Start the request but don't await it
      const promise = result.sendMessage('test');

      // The ref[0] should be the abortControllerRef
      const controllerRef = refs[0]!;
      expect(controllerRef.current).toBeTruthy();

      // Cancel
      result.cancelRequest();

      expect(states[S.isLoading]!.value).toBe(false);
      expect(controllerRef.current).toBeNull();

      // Resolve fetch to clean up
      fetchResolve!(createJsonResponse({ success: true, data: { response: 'late', conversationId: 'c1' } }));
      await promise;
    });

    it('sets isLoading to false on cancel', () => {
      const result = callHook();
      states[S.isLoading]!.value = true;

      // Set up a fake controller in the ref
      const controller = new AbortController();
      refs[0]!.current = controller;

      result.cancelRequest();

      expect(states[S.isLoading]!.value).toBe(false);
    });

    it('clears streamingContent and progressEvents on cancel', () => {
      const result = callHook();
      states[S.streamingContent]!.value = 'partial data';
      states[S.progressEvents]!.value = [{ type: 'status', message: 'working' }];

      const controller = new AbortController();
      refs[0]!.current = controller;

      result.cancelRequest();

      expect(states[S.streamingContent]!.value).toBe('');
      expect(states[S.progressEvents]!.value).toEqual([]);
    });

    it('null controller is safely handled', () => {
      const result = callHook();
      refs[0]!.current = null;

      // Should not throw
      expect(() => result.cancelRequest()).not.toThrow();
      // isLoading should not change since there was no controller
      expect(states[S.isLoading]!.value).toBe(false);
    });
  });

  // ── 8. Retry ───────────────────────────────────────────────────────────

  describe('retryLastMessage', () => {
    it('sends the lastFailedMessage', async () => {
      mockFetch.mockResolvedValue(createJsonResponse({
        success: true,
        data: { response: 'Ok', conversationId: 'conv-1' },
      }));

      // First render to create state slots
      initHook();
      states[S.lastFailedMessage]!.value = 'retry this';

      // Re-call hook to pick up updated lastFailedMessage
      const result = callHook();
      await result.retryLastMessage();

      expect(mockFetch).toHaveBeenCalledOnce();
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.message).toBe('retry this');
    });

    it('removes last error message on retry (isRetry=true)', async () => {
      // First render to create state slots
      initHook();

      // Set up initial messages with an error at the end
      states[S.messages]!.value = [
        { id: '1', role: 'user', content: 'original', timestamp: '2024-01-01' },
        { id: '2', role: 'assistant', content: 'Error!', timestamp: '2024-01-01', isError: true },
      ];
      states[S.lastFailedMessage]!.value = 'original';

      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'Fixed answer', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.retryLastMessage();

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      // Error message should have been removed, then assistant added
      const errorMessages = messages.filter((m) => m.isError === true);
      expect(errorMessages).toHaveLength(0);
    });

    it('is no-op when no lastFailedMessage', async () => {
      initHook();
      states[S.lastFailedMessage]!.value = null;

      const result = callHook();
      await result.retryLastMessage();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not add duplicate user message on retry', async () => {
      // First render to create state slots
      initHook();

      states[S.messages]!.value = [
        { id: '1', role: 'user', content: 'my question', timestamp: '2024-01-01' },
        { id: '2', role: 'assistant', content: 'Error', timestamp: '2024-01-01', isError: true },
      ];
      states[S.lastFailedMessage]!.value = 'my question';

      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'answer', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.retryLastMessage();

      const messages = states[S.messages]!.value as Array<{ role: string; content: string }>;
      const userMessages = messages.filter((m) => m.role === 'user');
      // Should still have exactly 1 user message (no duplicate added on retry)
      expect(userMessages).toHaveLength(1);
    });
  });

  // ── 9. clearMessages ───────────────────────────────────────────────────

  describe('clearMessages', () => {
    it('resets all state', () => {
      // First render to create state slots
      initHook();

      // Dirty up all state
      states[S.messages]!.value = [{ id: '1', role: 'user', content: 'test', timestamp: '' }];
      states[S.error]!.value = 'some error';
      states[S.lastFailedMessage]!.value = 'failed msg';
      states[S.streamingContent]!.value = 'streaming...';
      states[S.progressEvents]!.value = [{ type: 'status' }];

      const result = callHook();
      result.clearMessages();

      expect(states[S.messages]!.value).toEqual([]);
      expect(states[S.error]!.value).toBeNull();
      expect(states[S.lastFailedMessage]!.value).toBeNull();
      expect(states[S.streamingContent]!.value).toBe('');
      expect(states[S.progressEvents]!.value).toEqual([]);
    });

    it('cancels ongoing request', () => {
      // First render to create refs
      initHook();

      const controller = new AbortController();
      refs[0]!.current = controller;
      const abortSpy = vi.spyOn(controller, 'abort');

      const result = callHook();
      result.clearMessages();

      expect(abortSpy).toHaveBeenCalled();
    });

    it('works when no ongoing request', () => {
      const result = callHook();
      refs[0]!.current = null;

      expect(() => result.clearMessages()).not.toThrow();
      expect(states[S.messages]!.value).toEqual([]);
    });
  });

  // ── 10. Provider/model setters ─────────────────────────────────────────

  describe('provider/model setters', () => {
    it('setProvider updates provider state', () => {
      const result = callHook();
      result.setProvider('google');
      expect(states[S.provider]!.value).toBe('google');
    });

    it('setModel updates model state', () => {
      const result = callHook();
      result.setModel('gemini-pro');
      expect(states[S.model]!.value).toBe('gemini-pro');
    });

    it('setAgentId updates agentId state', () => {
      const result = callHook();
      result.setAgentId('new-agent');
      expect(states[S.agentId]!.value).toBe('new-agent');
    });

    it('setWorkspaceId updates workspaceId state', () => {
      const result = callHook();
      result.setWorkspaceId('new-ws');
      expect(states[S.workspaceId]!.value).toBe('new-ws');
    });
  });

  // ── 11. Edge cases and additional coverage ─────────────────────────────

  describe('edge cases', () => {
    it('aborts previous request when sending a new message', async () => {
      let firstFetchResolve: (v: Response) => void;
      mockFetch.mockImplementationOnce(
        () => new Promise<Response>((resolve) => { firstFetchResolve = resolve; })
      );
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'second', conversationId: 'conv-1' },
      }));

      const result = callHook();

      // Start first request
      const firstPromise = result.sendMessage('first');

      // The controller ref should be set
      const firstController = refs[0]!.current as AbortController;
      expect(firstController).toBeTruthy();

      // Send second message — should abort first
      const secondPromise = result.sendMessage('second');

      // First controller should be aborted
      expect(firstController.signal.aborted).toBe(true);

      // Resolve the first fetch to let promise settle
      firstFetchResolve!(createJsonResponse({
        success: true,
        data: { response: 'late first', conversationId: 'conv-1' },
      }));

      await Promise.all([firstPromise, secondPromise]);
    });

    it('cleanup effect aborts controller on unmount', () => {
      callHook();

      // Simulate a live controller
      const controller = new AbortController();
      refs[0]!.current = controller;
      const abortSpy = vi.spyOn(controller, 'abort');

      // Run cleanup effects (simulating unmount)
      effectCleanups.forEach((fn) => fn());

      expect(abortSpy).toHaveBeenCalled();
    });

    it('handles event: prefix lines in SSE (skips them)', async () => {
      // Create raw SSE with event: type lines
      const encoder = new TextEncoder();
      const raw = encoder.encode(
        `event: message\ndata: ${JSON.stringify({ delta: 'content' })}\n\nevent: done\ndata: ${JSON.stringify({ delta: '', done: true, id: '1', conversationId: 'c1' })}\n\n`
      );

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(raw);
          controller.close();
        },
      });

      const response = new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      mockFetch.mockResolvedValueOnce(response);

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('content');
    });

    it('no response body throws error', async () => {
      // Create response with text/event-stream but null body
      const response = new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      // Override body to null
      Object.defineProperty(response, 'body', { value: null });
      mockFetch.mockResolvedValueOnce(response);

      const result = callHook();
      await result.sendMessage('test');

      expect(states[S.error]!.value).toBe('No response body');
    });

    it('clears lastFailedMessage on successful response', async () => {
      // First render to create state slots
      initHook();
      states[S.lastFailedMessage]!.value = 'old failure';

      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'success!', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('new msg');

      expect(states[S.lastFailedMessage]!.value).toBeNull();
    });

    it('uses model from finalResponse when available in SSE', async () => {
      const sseResponse = createSSEResponse([
        { data: JSON.stringify({ delta: 'answer' }) },
        {
          data: JSON.stringify({
            delta: '',
            done: true,
            id: '1',
            conversationId: 'c1',
          }),
        },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook({ model: 'gpt-4' });
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      // Line 215 sets finalResponse.model to the local `model` variable
      // Line 243 uses `finalResponse?.model ?? model` — both are 'gpt-4'
      expect(assistantMsg!.model).toBe('gpt-4');
    });

    it('uses model from JSON response data when available', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          response: 'answer',
          conversationId: 'conv-1',
          model: 'claude-3.5-sonnet',
        },
      }));

      const result = callHook({ model: 'claude-3' });
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      // Line 264: `model: data.data.model ?? model` — uses response model first
      expect(assistantMsg!.model).toBe('claude-3.5-sonnet');
    });

    it('malformed SSE data is silently handled', async () => {
      const sseResponse = createSSEResponse([
        { data: 'not-valid-json{{{' },
        { data: JSON.stringify({ delta: 'valid', done: true, id: '1', conversationId: 'c1' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = callHook();
      await result.sendMessage('test');

      warnSpy.mockRestore();

      // Should still complete with the valid data
      const messages = states[S.messages]!.value as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('valid');
    });

    it('signal includes abort signal in fetch call', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'ok', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('test');

      const fetchOpts = mockFetch.mock.calls[0]![1];
      expect(fetchOpts.signal).toBeDefined();
      expect(fetchOpts.signal).toBeInstanceOf(AbortSignal);
    });

    it('stream with only done event and no content creates empty assistant message', async () => {
      const sseResponse = createSSEResponse([
        { data: JSON.stringify({ delta: '', done: true, id: '1', conversationId: 'c1' }) },
      ]);
      mockFetch.mockResolvedValueOnce(sseResponse);

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      // Content comes from accumulatedContent || finalResponse?.response
      // accumulatedContent is '' and finalResponse.response is '' => ''
      expect(assistantMsg!.content).toBe('');
    });

    it('empty data: line is skipped', async () => {
      // Send an SSE event with "data: " and nothing after it
      const encoder = new TextEncoder();
      const raw = encoder.encode(
        `data: \n\ndata: ${JSON.stringify({ delta: 'real', done: true, id: '1', conversationId: 'c1' })}\n\n`
      );

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(raw);
          controller.close();
        },
      });

      const response = new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
      mockFetch.mockResolvedValueOnce(response);

      const result = callHook();
      await result.sendMessage('test');

      const messages = states[S.messages]!.value as Array<{ role: string; content: string }>;
      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg?.content).toBe('real');
    });

    it('timestamp is set on user message', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'ok', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('hello');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg!.timestamp).toBeDefined();
      expect(typeof userMsg!.timestamp).toBe('string');
      // Should be a valid ISO string
      expect(new Date(userMsg!.timestamp as string).toISOString()).toBe(userMsg!.timestamp);
    });

    it('user message gets a unique id', async () => {
      mockFetch.mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: { response: 'ok', conversationId: 'conv-1' },
      }));

      const result = callHook();
      await result.sendMessage('hello');

      const messages = states[S.messages]!.value as Array<Record<string, unknown>>;
      const userMsg = messages.find((m) => m.role === 'user');
      expect(userMsg!.id).toBeDefined();
      expect(typeof userMsg!.id).toBe('string');
      expect((userMsg!.id as string).startsWith('test-uuid-')).toBe(true);
    });
  });
});
