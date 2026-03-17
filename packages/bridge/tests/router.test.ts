/**
 * Router — Unit Tests
 *
 * Tests routeMessage() — the 5-layer routing pipeline:
 *   1. Slash command interception
 *   2. Regex intent routing
 *   3. LLM fallback routing
 *   4. GSD context injection
 *   5. CC spawn + sendWithPatternDetection
 *
 * All external dependencies are mocked — no real CC processes spawned.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks (hoisted before imports)
// ─────────────────────────────────────────────────────────────────────────────

const mockGetSession = vi.hoisted(() => vi.fn());
const mockSetConfigOverrides = vi.hoisted(() => vi.fn());
const mockGetConfigOverrides = vi.hoisted(() => vi.fn());
const mockSetDisplayName = vi.hoisted(() => vi.fn());
const mockGetDisplayName = vi.hoisted(() => vi.fn());
const mockTerminate = vi.hoisted(() => vi.fn());
const mockListDiskSessions = vi.hoisted(() => vi.fn());
const mockGetSessionJsonlPath = vi.hoisted(() => vi.fn());
const mockGetOrCreate = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());
const mockSetPendingApproval = vi.hoisted(() => vi.fn());
const mockWasPatternDetected = vi.hoisted(() => vi.fn().mockReturnValue(false));

const mockTryInterceptCommand = vi.hoisted(() => vi.fn());
const mockResolveIntent = vi.hoisted(() => vi.fn());
const mockResolveLLMIntent = vi.hoisted(() => vi.fn());
const mockGetGSDContext = vi.hoisted(() => vi.fn());
const mockFireBlockingWebhooks = vi.hoisted(() => vi.fn());
const mockEventBusEmit = vi.hoisted(() => vi.fn());
const mockMatchPatterns = vi.hoisted(() => vi.fn());
const mockIsBlocking = vi.hoisted(() => vi.fn());
const mockHasStructuredOutput = vi.hoisted(() => vi.fn());

const mockConfig = vi.hoisted(() => ({
  defaultProjectDir: '/test',
  minimaxApiKey: '',
  claudeModel: 'test-model',
  port: 9090,
}));

vi.mock('../src/claude-manager.ts', () => ({
  claudeManager: {
    getSession: mockGetSession,
    setConfigOverrides: mockSetConfigOverrides,
    getConfigOverrides: mockGetConfigOverrides,
    setDisplayName: mockSetDisplayName,
    getDisplayName: mockGetDisplayName,
    terminate: mockTerminate,
    listDiskSessions: mockListDiskSessions,
    getSessionJsonlPath: mockGetSessionJsonlPath,
    getOrCreate: mockGetOrCreate,
    send: mockSend,
    setPendingApproval: mockSetPendingApproval,
    wasPatternDetected: mockWasPatternDetected,
  },
}));

vi.mock('../src/gsd-adapter.ts', () => ({
  getGSDContext: mockGetGSDContext,
}));

vi.mock('../src/commands/index.ts', () => ({
  tryInterceptCommand: mockTryInterceptCommand,
}));

vi.mock('../src/commands/intent-adapter.ts', () => ({
  resolveIntent: mockResolveIntent,
}));

vi.mock('../src/commands/llm-router.ts', () => ({
  resolveLLMIntent: mockResolveLLMIntent,
}));

vi.mock('../src/config.ts', () => ({
  get config() {
    return mockConfig;
  },
}));

vi.mock('../src/utils/logger.ts', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../src/webhook-sender.ts', () => ({
  fireBlockingWebhooks: mockFireBlockingWebhooks,
}));

vi.mock('../src/event-bus.ts', () => ({
  eventBus: {
    emit: mockEventBusEmit,
  },
}));

vi.mock('../src/pattern-matcher.ts', () => ({
  matchPatterns: mockMatchPatterns,
  isBlocking: mockIsBlocking,
  hasStructuredOutput: mockHasStructuredOutput,
}));

// Import AFTER mocks are declared
import { routeMessage, type RouteOptions } from '../src/router.ts';
import type { ChatCompletionRequest, StreamChunk } from '../src/types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Consume an AsyncGenerator into an array of chunks. */
async function consumeStream(stream: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

/** Build a minimal ChatCompletionRequest with a single user message. */
function makeRequest(
  userMessage: string,
  metadata?: ChatCompletionRequest['metadata'],
  model?: string,
): ChatCompletionRequest {
  return {
    model: model ?? 'test-model',
    messages: [{ role: 'user', content: userMessage }],
    metadata,
  };
}

/** Create a synthetic async generator that yields text + done (mimicking command streams). */
async function* makeSyntheticStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'text', text };
  yield { type: 'done' };
}

/** Create an async generator mimicking CC send() output. */
async function* makeCCSendStream(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'text', text };
  yield { type: 'done' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('routeMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks: everything falls through to CC
    mockTryInterceptCommand.mockResolvedValue(null);
    mockResolveIntent.mockReturnValue(null);
    mockResolveLLMIntent.mockResolvedValue({
      command: null,
      confidence: 0,
      reasoning: '',
      fromLLM: false,
    });
    mockGetGSDContext.mockResolvedValue({
      fullSystemPrompt: undefined,
      command: null,
    });
    mockGetSession.mockReturnValue(null);
    mockGetOrCreate.mockResolvedValue({
      conversationId: 'test-conv',
      sessionId: 'test-session-uuid',
      processAlive: true,
      lastActivity: new Date(),
      projectDir: '/test',
      tokensUsed: 0,
      budgetUsed: 0,
      pendingApproval: null,
    });
    mockSend.mockImplementation(function* () {
      yield { type: 'text' as const, text: 'response' };
      yield { type: 'done' as const };
    });
    mockHasStructuredOutput.mockReturnValue(false);
    mockIsBlocking.mockReturnValue(false);
    mockMatchPatterns.mockReturnValue([]);
    mockGetConfigOverrides.mockReturnValue({});

    // Reset config defaults
    mockConfig.defaultProjectDir = '/test';
    mockConfig.minimaxApiKey = '';
    mockConfig.claudeModel = 'test-model';
    mockConfig.port = 9090;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Layer 1: Slash command interception
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Layer 1: Slash command interception', () => {
    it('returns intercepted stream when tryInterceptCommand handles /help', async () => {
      const helpStream = makeSyntheticStream('Help output');
      mockTryInterceptCommand.mockResolvedValueOnce(helpStream);

      const result = await routeMessage(makeRequest('/help'));

      expect(result.stream).toBe(helpStream);
      expect(mockGetOrCreate).not.toHaveBeenCalled();
      // tryInterceptCommand called with raw message and context
      expect(mockTryInterceptCommand).toHaveBeenCalledWith('/help', expect.objectContaining({
        conversationId: expect.any(String),
        projectDir: '/test',
      }));
    });

    it('returns intercepted stream when tryInterceptCommand handles /rename foo', async () => {
      const renameStream = makeSyntheticStream('Renamed to foo');
      mockTryInterceptCommand.mockResolvedValueOnce(renameStream);

      const result = await routeMessage(makeRequest('/rename foo'));

      expect(result.stream).toBe(renameStream);
      expect(mockGetOrCreate).not.toHaveBeenCalled();
    });

    it('falls through when tryInterceptCommand returns null for unknown command', async () => {
      // default: mockTryInterceptCommand returns null
      const result = await routeMessage(makeRequest('/unknown-cmd'));

      // Should have fallen through to CC (getOrCreate called)
      expect(mockGetOrCreate).toHaveBeenCalled();
    });

    it('sessionId in response comes from claudeManager.getSession when intercepted', async () => {
      mockGetSession.mockReturnValue({
        sessionId: 'existing-session-id',
        conversationId: 'conv-1',
      });
      const stream = makeSyntheticStream('OK');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      const result = await routeMessage(makeRequest('/help'));

      expect(result.sessionId).toBe('existing-session-id');
    });

    it('sessionId is empty string when no session exists and command intercepted', async () => {
      mockGetSession.mockReturnValue(null);
      const stream = makeSyntheticStream('OK');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      const result = await routeMessage(makeRequest('/help'));

      expect(result.sessionId).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Layer 2: Intent routing (resolveIntent → tryInterceptCommand)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Layer 2: Intent routing', () => {
    it('resolveIntent maps "ne kadar harcadim" to /cost and intercepts', async () => {
      // First call: slash command check → null
      mockTryInterceptCommand.mockResolvedValueOnce(null);
      // Second call: intent command → intercepted
      const costStream = makeSyntheticStream('$1.23 used');
      mockTryInterceptCommand.mockResolvedValueOnce(costStream);
      mockResolveIntent.mockReturnValueOnce('/cost');

      const result = await routeMessage(makeRequest('ne kadar harcadim'));

      expect(result.stream).toBe(costStream);
      expect(mockTryInterceptCommand).toHaveBeenCalledTimes(2);
      // Second call should be with the resolved intent command
      expect(mockTryInterceptCommand).toHaveBeenNthCalledWith(
        2,
        '/cost',
        expect.objectContaining({ conversationId: expect.any(String) }),
      );
      expect(mockGetOrCreate).not.toHaveBeenCalled();
    });

    it('falls through to CC when resolveIntent returns /cost but tryInterceptCommand returns null', async () => {
      // Both calls return null
      mockTryInterceptCommand.mockResolvedValue(null);
      mockResolveIntent.mockReturnValueOnce('/cost');

      const result = await routeMessage(makeRequest('ne kadar harcadim'));

      // Should fall through to CC
      expect(mockGetOrCreate).toHaveBeenCalled();
    });

    it('skips intent routing when resolveIntent returns null', async () => {
      // default: resolveIntent returns null
      mockTryInterceptCommand.mockResolvedValue(null);

      await routeMessage(makeRequest('write a poem'));

      // tryInterceptCommand called only once (slash check), not twice
      expect(mockTryInterceptCommand).toHaveBeenCalledTimes(1);
      expect(mockTryInterceptCommand).toHaveBeenCalledWith('write a poem', expect.any(Object));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Layer 3: LLM fallback routing
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Layer 3: LLM fallback routing', () => {
    it('calls resolveLLMIntent when minimaxApiKey is set and resolveIntent returned null', async () => {
      mockConfig.minimaxApiKey = 'mm-test-key';
      mockTryInterceptCommand
        .mockResolvedValueOnce(null) // slash check
        .mockResolvedValueOnce(null); // LLM intent (falls through)
      mockResolveLLMIntent.mockResolvedValueOnce({
        command: null,
        confidence: 0,
        reasoning: '',
        fromLLM: false,
      });

      await routeMessage(makeRequest('ambiguous message'));

      expect(mockResolveLLMIntent).toHaveBeenCalledWith('ambiguous message');
    });

    it('intercepts when LLM returns a valid command', async () => {
      mockConfig.minimaxApiKey = 'mm-test-key';
      const llmStream = makeSyntheticStream('$1.23');
      // Reset to clear beforeEach default, then set fresh once values
      mockTryInterceptCommand.mockReset();
      mockTryInterceptCommand
        .mockResolvedValueOnce(null)   // call 1: slash check → pass through
        .mockResolvedValueOnce(llmStream); // call 2: LLM intent → intercepted
      mockResolveLLMIntent.mockResolvedValueOnce({
        command: '/cost',
        confidence: 0.95,
        reasoning: 'user asks about spend',
        fromLLM: true,
      });

      const result = await routeMessage(makeRequest('how much'));

      // Verify the stream content matches
      const chunks = await consumeStream(result.stream);
      expect(chunks[0]).toEqual({ type: 'text', text: '$1.23' });

      expect(mockTryInterceptCommand).toHaveBeenCalledTimes(2);
      expect(mockTryInterceptCommand).toHaveBeenNthCalledWith(
        2,
        '/cost',
        expect.objectContaining({ conversationId: expect.any(String) }),
      );
      expect(mockGetOrCreate).not.toHaveBeenCalled();
    });

    it('skips LLM when minimaxApiKey is empty', async () => {
      mockConfig.minimaxApiKey = '';
      mockTryInterceptCommand.mockResolvedValue(null);

      await routeMessage(makeRequest('ambiguous'));

      expect(mockResolveLLMIntent).not.toHaveBeenCalled();
    });

    it('skips LLM when resolveIntent returned a non-null value (even if minimaxApiKey set)', async () => {
      mockConfig.minimaxApiKey = 'mm-test-key';
      mockResolveIntent.mockReturnValueOnce('/status');
      // Slash check pass, intent command also passes (CC-delegated)
      mockTryInterceptCommand.mockResolvedValue(null);

      await routeMessage(makeRequest('ne durumda'));

      // LLM should NOT be called because resolveIntent returned non-null
      expect(mockResolveLLMIntent).not.toHaveBeenCalled();
    });

    it('falls through when LLM returns null command', async () => {
      mockConfig.minimaxApiKey = 'mm-test-key';
      mockTryInterceptCommand.mockResolvedValue(null);
      mockResolveLLMIntent.mockResolvedValueOnce({
        command: null,
        confidence: 0,
        reasoning: '',
        fromLLM: false,
      });

      const result = await routeMessage(makeRequest('complex message'));

      expect(mockGetOrCreate).toHaveBeenCalled();
    });

    it('falls through when LLM returns command but tryInterceptCommand returns null', async () => {
      mockConfig.minimaxApiKey = 'mm-test-key';
      mockTryInterceptCommand.mockResolvedValue(null); // all calls return null
      mockResolveLLMIntent.mockResolvedValueOnce({
        command: '/cost',
        confidence: 0.85,
        reasoning: 'possible cost query',
        fromLLM: true,
      });

      const result = await routeMessage(makeRequest('maybe cost'));

      // Should fall through to CC
      expect(mockGetOrCreate).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Layer 4: GSD context injection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Layer 4: GSD context', () => {
    it('passes system prompt from getGSDContext to getOrCreate', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockGetGSDContext.mockResolvedValueOnce({
        fullSystemPrompt: 'GSD system prompt here',
        command: 'execute-phase',
      });

      await routeMessage(makeRequest('execute next phase'));

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ systemPrompt: 'GSD system prompt here' }),
      );
    });

    it('continues without system prompt when getGSDContext throws', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockGetGSDContext.mockRejectedValueOnce(new Error('GSD file not found'));

      const result = await routeMessage(makeRequest('some message'));

      // Should still succeed — getOrCreate called with undefined systemPrompt
      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ systemPrompt: undefined }),
      );
      expect(result.sessionId).toBe('test-session-uuid');
    });

    it('systemPrompt is undefined when getGSDContext returns no prompt', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockGetGSDContext.mockResolvedValueOnce({
        fullSystemPrompt: undefined,
        command: null,
      });

      await routeMessage(makeRequest('hello'));

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ systemPrompt: undefined }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Layer 5: CC spawn + sendWithPatternDetection
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Layer 5: CC spawn', () => {
    it('calls getOrCreate with correct projectDir, sessionId, model', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      await routeMessage(makeRequest('hello', undefined, 'claude-opus-4'));

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          projectDir: '/test',
          model: 'claude-opus-4',
        }),
      );
    });

    it('returns a consumable stream with text + done chunks', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'Hello world' };
        yield { type: 'done' as const };
      });

      const result = await routeMessage(makeRequest('hi'));
      const chunks = await consumeStream(result.stream);

      expect(chunks).toEqual([
        { type: 'text', text: 'Hello world' },
        { type: 'done' },
      ]);
    });

    it('returns sessionId from getOrCreate', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      const result = await routeMessage(makeRequest('test'));

      expect(result.sessionId).toBe('test-session-uuid');
    });

    it('passes sessionId from options to getOrCreate', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      await routeMessage(makeRequest('test'), { sessionId: 'my-session' });

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sessionId: 'my-session' }),
      );
    });

    it('passes sessionId from metadata when no options.sessionId', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      await routeMessage(
        makeRequest('test', { session_id: 'meta-session' }),
      );

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ sessionId: 'meta-session' }),
      );
    });

    it('uses config.claudeModel as fallback when request.model is undefined', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockConfig.claudeModel = 'claude-sonnet-4-6';

      const req: ChatCompletionRequest = {
        model: undefined as unknown as string,
        messages: [{ role: 'user', content: 'hi' }],
      };

      await routeMessage(req);

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  sendWithPatternDetection (post-stream processing)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('sendWithPatternDetection', () => {
    it('emits phase_complete event when PHASE_COMPLETE pattern detected', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'Phase 1 complete — all tests pass' };
        yield { type: 'done' as const };
      });
      mockHasStructuredOutput.mockReturnValue(true);
      mockMatchPatterns.mockReturnValue([
        { key: 'PHASE_COMPLETE', value: 'Phase 1 complete — all tests pass', raw: 'Phase 1 complete — all tests pass' },
      ]);
      mockGetSession.mockReturnValue({
        conversationId: 'conv-1',
        sessionId: 'sess-1',
      });

      const result = await routeMessage(makeRequest('next phase'));
      await consumeStream(result.stream);

      expect(mockEventBusEmit).toHaveBeenCalledWith(
        'session.phase_complete',
        expect.objectContaining({
          type: 'session.phase_complete',
          pattern: 'PHASE_COMPLETE',
        }),
      );
    });

    it('sets pendingApproval and fires webhooks on blocking pattern', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'QUESTION: Which database?' };
        yield { type: 'done' as const };
      });
      mockHasStructuredOutput.mockReturnValue(true);
      mockIsBlocking.mockReturnValue(true);
      mockMatchPatterns.mockReturnValue([
        { key: 'QUESTION', value: 'Which database?', raw: 'QUESTION: Which database?' },
      ]);
      mockGetSession.mockReturnValue({
        conversationId: 'conv-1',
        sessionId: 'sess-1',
      });

      const result = await routeMessage(makeRequest('do task'));
      await consumeStream(result.stream);

      expect(mockSetPendingApproval).toHaveBeenCalledWith(
        expect.any(String), // conversationId
        'QUESTION',
        'Which database?',
      );
      expect(mockEventBusEmit).toHaveBeenCalledWith(
        'session.blocking',
        expect.objectContaining({
          type: 'session.blocking',
          pattern: 'QUESTION',
          text: 'Which database?',
        }),
      );
      expect(mockFireBlockingWebhooks).toHaveBeenCalled();
    });

    it('does not fire blocking webhooks when isBlocking returns false', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'PROGRESS: Step 1 done' };
        yield { type: 'done' as const };
      });
      mockHasStructuredOutput.mockReturnValue(true);
      mockIsBlocking.mockReturnValue(false);
      mockMatchPatterns.mockReturnValue([
        { key: 'PROGRESS', value: 'Step 1 done', raw: 'PROGRESS: Step 1 done' },
      ]);

      const result = await routeMessage(makeRequest('check status'));
      await consumeStream(result.stream);

      expect(mockSetPendingApproval).not.toHaveBeenCalled();
      expect(mockFireBlockingWebhooks).not.toHaveBeenCalled();
    });

    it('does not check patterns when hasStructuredOutput returns false', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'plain response' };
        yield { type: 'done' as const };
      });
      mockHasStructuredOutput.mockReturnValue(false);

      const result = await routeMessage(makeRequest('hi'));
      await consumeStream(result.stream);

      expect(mockMatchPatterns).not.toHaveBeenCalled();
      expect(mockIsBlocking).not.toHaveBeenCalled();
    });

    it('emits blocking event with correct respondUrl using config.port', async () => {
      mockConfig.port = 8080;
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'TASK_BLOCKED: Need approval' };
        yield { type: 'done' as const };
      });
      mockHasStructuredOutput.mockReturnValue(true);
      mockIsBlocking.mockReturnValue(true);
      mockMatchPatterns.mockReturnValue([
        { key: 'TASK_BLOCKED', value: 'Need approval', raw: 'TASK_BLOCKED: Need approval' },
      ]);
      mockGetSession.mockReturnValue({
        conversationId: 'conv-1',
        sessionId: 'sess-1',
      });

      const result = await routeMessage(makeRequest('blocked task'));
      await consumeStream(result.stream);

      expect(mockEventBusEmit).toHaveBeenCalledWith(
        'session.blocking',
        expect.objectContaining({
          // B5: interactive path uses /input, not legacy /respond
          respondUrl: 'http://localhost:8080/v1/sessions/sess-1/input',
        }),
      );
    });

    it('skips Layer 1 pattern detection when processInteractiveOutput already ran (B4)', async () => {
      // Simulate: Layer 2 already set the flag during runViaInteractive
      mockWasPatternDetected.mockReturnValue(true);
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'QUESTION: Which database?' };
        yield { type: 'done' as const };
      });
      mockHasStructuredOutput.mockReturnValue(true);
      mockIsBlocking.mockReturnValue(true);
      mockMatchPatterns.mockReturnValue([
        { key: 'QUESTION', value: 'Which database?', raw: 'QUESTION: Which database?' },
      ]);
      mockGetSession.mockReturnValue({ conversationId: 'conv-1', sessionId: 'sess-1' });

      const result = await routeMessage(makeRequest('do task'));
      await consumeStream(result.stream);

      // Layer 1 must NOT fire — Layer 2 already ran pattern detection
      expect(mockSetPendingApproval).not.toHaveBeenCalled();
      expect(mockEventBusEmit).not.toHaveBeenCalledWith('session.blocking', expect.anything());
      expect(mockFireBlockingWebhooks).not.toHaveBeenCalled();
    });

    it('still runs Layer 1 detection when wasPatternDetected is false (SDK path)', async () => {
      // SDK path: runViaInteractive never ran, flag stays false → Layer 1 must run
      mockWasPatternDetected.mockReturnValue(false);
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'QUESTION: Which database?' };
        yield { type: 'done' as const };
      });
      mockHasStructuredOutput.mockReturnValue(true);
      mockIsBlocking.mockReturnValue(true);
      mockMatchPatterns.mockReturnValue([
        { key: 'QUESTION', value: 'Which database?', raw: 'QUESTION: Which database?' },
      ]);
      mockGetSession.mockReturnValue({ conversationId: 'conv-1', sessionId: 'sess-1' });

      const result = await routeMessage(makeRequest('sdk task'));
      await consumeStream(result.stream);

      expect(mockSetPendingApproval).toHaveBeenCalled();
      expect(mockEventBusEmit).toHaveBeenCalledWith('session.blocking', expect.anything());
    });

    it('skips phase_complete emit when Layer 2 already detected pattern (B4)', async () => {
      mockWasPatternDetected.mockReturnValue(true);
      mockTryInterceptCommand.mockResolvedValue(null);
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'PHASE_COMPLETE: Phase 1 done' };
        yield { type: 'done' as const };
      });
      mockHasStructuredOutput.mockReturnValue(true);
      mockMatchPatterns.mockReturnValue([
        { key: 'PHASE_COMPLETE', value: 'Phase 1 done', raw: 'PHASE_COMPLETE: Phase 1 done' },
      ]);
      mockGetSession.mockReturnValue({ conversationId: 'conv-1', sessionId: 'sess-1' });

      const result = await routeMessage(makeRequest('phase task'));
      await consumeStream(result.stream);

      expect(mockEventBusEmit).not.toHaveBeenCalledWith('session.phase_complete', expect.anything());
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Conversation ID resolution
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Conversation ID resolution', () => {
    it('uses conversationId from options when provided', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      const result = await routeMessage(
        makeRequest('hi', { conversation_id: 'meta-conv' }),
        { conversationId: 'opts-conv' },
      );

      expect(result.conversationId).toBe('opts-conv');
    });

    it('uses conversationId from metadata when no options.conversationId', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      const result = await routeMessage(
        makeRequest('hi', { conversation_id: 'meta-conv' }),
      );

      expect(result.conversationId).toBe('meta-conv');
    });

    it('generates a UUID when neither options nor metadata have conversationId', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      const result = await routeMessage(makeRequest('hi'));

      // UUID format: 8-4-4-4-12 hex chars
      expect(result.conversationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Project directory resolution
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Project directory resolution', () => {
    it('uses projectDir from options when provided', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      await routeMessage(makeRequest('hi'), { projectDir: '/custom/project' });

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ projectDir: '/custom/project' }),
      );
    });

    it('uses projectDir from metadata when no options.projectDir', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      await routeMessage(makeRequest('hi', { project_dir: '/meta/project' }));

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ projectDir: '/meta/project' }),
      );
    });

    it('falls back to config.defaultProjectDir', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockConfig.defaultProjectDir = '/default-dir';

      await routeMessage(makeRequest('hi'));

      expect(mockGetOrCreate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ projectDir: '/default-dir' }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Error handling
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Error handling', () => {
    it('returns error stream when no user message in request', async () => {
      const req: ChatCompletionRequest = {
        model: 'test',
        messages: [{ role: 'assistant', content: 'I am an assistant' }],
      };

      const result = await routeMessage(req);
      const chunks = await consumeStream(result.stream);

      expect(chunks).toEqual([
        { type: 'error', error: 'No user message in request' },
      ]);
      expect(result.sessionId).toBe('');
    });

    it('returns error stream when messages array is empty', async () => {
      const req: ChatCompletionRequest = {
        model: 'test',
        messages: [],
      };

      const result = await routeMessage(req);
      const chunks = await consumeStream(result.stream);

      expect(chunks).toEqual([
        { type: 'error', error: 'No user message in request' },
      ]);
    });

    it('returns error stream on unhandled error in routeMessage', async () => {
      mockTryInterceptCommand.mockRejectedValueOnce(new Error('Kaboom'));

      const result = await routeMessage(makeRequest('crash'));
      const chunks = await consumeStream(result.stream);

      expect(chunks).toEqual([
        { type: 'error', error: 'Internal routing error: Kaboom' },
      ]);
      expect(result.sessionId).toBe('');
    });

    it('returns error stream when getOrCreate throws', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);
      mockGetOrCreate.mockRejectedValueOnce(new Error('Spawn failed'));

      const result = await routeMessage(makeRequest('hello'));
      const chunks = await consumeStream(result.stream);

      expect(chunks).toEqual([
        { type: 'error', error: 'Internal routing error: Spawn failed' },
      ]);
    });

    it('stringifies non-Error exceptions', async () => {
      mockTryInterceptCommand.mockRejectedValueOnce('string error');

      const result = await routeMessage(makeRequest('crash'));
      const chunks = await consumeStream(result.stream);

      expect(chunks).toEqual([
        { type: 'error', error: 'Internal routing error: string error' },
      ]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Content extraction
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Content extraction', () => {
    it('extracts text from string content', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      const result = await routeMessage(makeRequest('hello world'));
      // Must consume stream to trigger send()
      await consumeStream(result.stream);

      // Verify send was called with the user message
      expect(mockSend).toHaveBeenCalledWith(
        expect.any(String),
        'hello world',
        '/test',
        undefined,
        { worktree: undefined, worktreeName: undefined },
      );
    });

    it('concatenates array of text blocks', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      const req: ChatCompletionRequest = {
        model: 'test',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ] as unknown as string,
        }],
      };

      const result = await routeMessage(req);
      await consumeStream(result.stream);

      expect(mockSend).toHaveBeenCalledWith(
        expect.any(String),
        'line one\nline two',
        '/test',
        undefined,
        { worktree: undefined, worktreeName: undefined },
      );
    });

    it('filters non-text blocks from array content', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      const req: ChatCompletionRequest = {
        model: 'test',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'hello' },
            { type: 'image', data: 'base64...' },
            { type: 'text', text: 'world' },
          ] as unknown as string,
        }],
      };

      const result = await routeMessage(req);
      await consumeStream(result.stream);

      expect(mockSend).toHaveBeenCalledWith(
        expect.any(String),
        'hello\nworld',
        '/test',
        undefined,
        { worktree: undefined, worktreeName: undefined },
      );
    });

    it('uses last user message from multiple messages', async () => {
      mockTryInterceptCommand.mockResolvedValue(null);

      const req: ChatCompletionRequest = {
        model: 'test',
        messages: [
          { role: 'user', content: 'first message' },
          { role: 'assistant', content: 'response' },
          { role: 'user', content: 'second message' },
        ],
      };

      const result = await routeMessage(req);
      await consumeStream(result.stream);

      expect(mockSend).toHaveBeenCalledWith(
        expect.any(String),
        'second message',
        '/test',
        undefined,
        { worktree: undefined, worktreeName: undefined },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  CommandContext construction
  // ═══════════════════════════════════════════════════════════════════════════

  describe('CommandContext construction', () => {
    it('has correct conversationId in context', async () => {
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { conversationId: 'ctx-conv-1' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      expect(ctxArg.conversationId).toBe('ctx-conv-1');
    });

    it('has correct projectDir in context', async () => {
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { projectDir: '/my/project' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      expect(ctxArg.projectDir).toBe('/my/project');
    });

    it('passes sessionInfo from claudeManager.getSession()', async () => {
      const sessionInfo = {
        conversationId: 'conv-1',
        sessionId: 'sess-1',
        processAlive: true,
        lastActivity: new Date(),
        projectDir: '/test',
        tokensUsed: 100,
        budgetUsed: 0.5,
        pendingApproval: null,
      };
      mockGetSession.mockReturnValue(sessionInfo);
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { conversationId: 'conv-1' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      expect(ctxArg.sessionInfo).toBe(sessionInfo);
    });

    it('sessionInfo is null when no session exists', async () => {
      mockGetSession.mockReturnValue(null);
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(makeRequest('test'));

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      expect(ctxArg.sessionInfo).toBeNull();
    });

    it('setConfigOverrides delegates to claudeManager', async () => {
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { conversationId: 'conv-1' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      ctxArg.setConfigOverrides({ model: 'opus' });
      expect(mockSetConfigOverrides).toHaveBeenCalledWith('conv-1', { model: 'opus' });
    });

    it('getConfigOverrides delegates to claudeManager', async () => {
      mockGetConfigOverrides.mockReturnValue({ fast: true });
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { conversationId: 'conv-1' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      const overrides = ctxArg.getConfigOverrides();
      expect(mockGetConfigOverrides).toHaveBeenCalledWith('conv-1');
      expect(overrides).toEqual({ fast: true });
    });

    it('terminate delegates to claudeManager', async () => {
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { conversationId: 'conv-1' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      ctxArg.terminate();
      expect(mockTerminate).toHaveBeenCalledWith('conv-1');
    });

    it('setDisplayName delegates to claudeManager', async () => {
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { conversationId: 'conv-1' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      ctxArg.setDisplayName('my session');
      expect(mockSetDisplayName).toHaveBeenCalledWith('conv-1', 'my session');
    });

    it('getDisplayName delegates to claudeManager', async () => {
      mockGetDisplayName.mockReturnValue('my session');
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { conversationId: 'conv-1' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      const name = ctxArg.getDisplayName();
      expect(mockGetDisplayName).toHaveBeenCalledWith('conv-1');
      expect(name).toBe('my session');
    });

    it('listDiskSessions delegates to claudeManager', async () => {
      mockListDiskSessions.mockReturnValue([]);
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(makeRequest('test'));

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      ctxArg.listDiskSessions('/some/dir');
      expect(mockListDiskSessions).toHaveBeenCalledWith('/some/dir');
    });

    it('getSessionJsonlPath delegates to claudeManager', async () => {
      mockGetSessionJsonlPath.mockReturnValue('/path/to/session.jsonl');
      const stream = makeSyntheticStream('ok');
      mockTryInterceptCommand.mockResolvedValueOnce(stream);

      await routeMessage(
        makeRequest('test'),
        { conversationId: 'conv-1' },
      );

      const ctxArg = mockTryInterceptCommand.mock.calls[0][1];
      const path = ctxArg.getSessionJsonlPath();
      expect(mockGetSessionJsonlPath).toHaveBeenCalledWith('conv-1');
      expect(path).toBe('/path/to/session.jsonl');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Integration-like: full pipeline traversal
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full pipeline traversal', () => {
    it('message passes through all 5 layers and returns CC response', async () => {
      // All interceptors return null → GSD has prompt → CC spawns
      mockTryInterceptCommand.mockResolvedValue(null);
      mockResolveIntent.mockReturnValue(null);
      mockConfig.minimaxApiKey = ''; // skip LLM
      mockGetGSDContext.mockResolvedValueOnce({
        fullSystemPrompt: 'You are GSD executor',
        command: 'execute-phase',
      });
      mockSend.mockImplementation(function* () {
        yield { type: 'text' as const, text: 'Task completed' };
        yield { type: 'done' as const };
      });

      const result = await routeMessage(
        makeRequest('execute next phase'),
        { conversationId: 'full-test', projectDir: '/my/project' },
      );

      expect(result.conversationId).toBe('full-test');
      expect(result.sessionId).toBe('test-session-uuid');

      const chunks = await consumeStream(result.stream);
      expect(chunks[0]).toEqual({ type: 'text', text: 'Task completed' });
      expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });

      // Verify the pipeline was traversed
      expect(mockTryInterceptCommand).toHaveBeenCalledTimes(1); // slash check only
      expect(mockResolveIntent).toHaveBeenCalledWith('execute next phase');
      expect(mockResolveLLMIntent).not.toHaveBeenCalled(); // minimaxApiKey empty
      expect(mockGetGSDContext).toHaveBeenCalledWith('execute next phase', '/my/project');
      expect(mockGetOrCreate).toHaveBeenCalledWith('full-test', expect.objectContaining({
        projectDir: '/my/project',
        systemPrompt: 'You are GSD executor',
      }));
    });

    it('slash command short-circuits before any other layer runs', async () => {
      const helpStream = makeSyntheticStream('Help output');
      mockTryInterceptCommand.mockResolvedValueOnce(helpStream);

      await routeMessage(makeRequest('/help'));

      expect(mockResolveIntent).not.toHaveBeenCalled();
      expect(mockResolveLLMIntent).not.toHaveBeenCalled();
      expect(mockGetGSDContext).not.toHaveBeenCalled();
      expect(mockGetOrCreate).not.toHaveBeenCalled();
    });

    it('intent routing short-circuits before LLM and CC', async () => {
      // Slash check passes
      mockTryInterceptCommand
        .mockResolvedValueOnce(null) // slash
        .mockResolvedValueOnce(makeSyntheticStream('$1.00')); // intent
      mockResolveIntent.mockReturnValueOnce('/cost');
      mockConfig.minimaxApiKey = 'mm-key'; // would trigger LLM if intent didnt match

      await routeMessage(makeRequest('ne kadar'));

      expect(mockResolveLLMIntent).not.toHaveBeenCalled();
      expect(mockGetGSDContext).not.toHaveBeenCalled();
      expect(mockGetOrCreate).not.toHaveBeenCalled();
    });
  });
});
