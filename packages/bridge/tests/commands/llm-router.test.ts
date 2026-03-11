/**
 * LLM Router — Unit Tests
 *
 * Tests resolveLLMIntent() — classifies ambiguous messages using Minimax
 * when regex-based resolveIntent() returns null.
 *
 * All Anthropic SDK calls are mocked — no real API calls made.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks (hoisted before imports)
// ─────────────────────────────────────────────────────────────────────────────

// vi.hoisted() runs before module evaluation — required for constructor mocks.
// Arrow functions cannot be used as constructors (new Foo()), so we use
// the `function` keyword for the MockAnthropic factory.
const mockCreate = vi.hoisted(() => vi.fn());
const mockConfig = vi.hoisted(() => ({
  minimaxApiKey: 'mm-test-key',
  minimaxBaseUrl: 'https://api.minimax.io/anthropic',
  minimaxModel: 'MiniMax-M2.5',
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(function MockAnthropic(
    this: { messages: { create: typeof mockCreate } },
  ) {
    this.messages = { create: mockCreate };
  }),
}));

vi.mock('../../src/config.ts', () => ({
  get config() {
    return mockConfig;
  },
}));

vi.mock('../../src/utils/logger.ts', () => ({
  logger: {
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Import AFTER mocks are declared (vitest hoists vi.mock calls)
import { resolveLLMIntent, _resetForTesting } from '../../src/commands/llm-router.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeToolUseResponse(
  command: string | null,
  confidence: number,
  reasoning = 'test reason',
) {
  return {
    content: [
      {
        type: 'tool_use',
        name: 'suggest_command',
        input: { command, confidence, reasoning },
      },
    ],
    usage: {
      cache_read_input_tokens: 0,
      input_tokens: 120,
      output_tokens: 28,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveLLMIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting(); // resets client, circuit breaker, cache
    mockConfig.minimaxApiKey = 'mm-test-key';
    mockConfig.minimaxBaseUrl = 'https://api.minimax.io/anthropic';
    mockConfig.minimaxModel = 'MiniMax-M2.5';
    vi.useRealTimers(); // ensure real timers by default
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('1. high confidence /cost → returns /cost, fromLLM true', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse('/cost', 0.95, 'user asks about spend'),
    );
    const result = await resolveLLMIntent('ne kadar harcadım');
    expect(result.command).toBe('/cost');
    expect(result.confidence).toBe(0.95);
    expect(result.fromLLM).toBe(true);
    expect(result.cached).toBeFalsy();
  });

  it('2. medium confidence /status (0.75 ≥ 0.70 threshold) → returns /status', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse('/status', 0.75, 'status query'));
    const result = await resolveLLMIntent('ne durumda');
    expect(result.command).toBe('/status');
    expect(result.fromLLM).toBe(true);
  });

  it('3. low confidence (0.60 < 0.70 threshold) → returns null', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse('/cost', 0.60, 'uncertain'));
    const result = await resolveLLMIntent('bir şeyler yap');
    expect(result.command).toBeNull();
    expect(result.fromLLM).toBe(false);
  });

  // ── Timeout ────────────────────────────────────────────────────────────────

  it('4. API timeout (4.5s) → returns null, fromLLM false', async () => {
    vi.useFakeTimers();
    // mockCreate never resolves
    mockCreate.mockImplementationOnce(() => new Promise(() => {}));

    const promise = resolveLLMIntent('timeout test message');
    // Advance fake time past 4.5s threshold
    await vi.advanceTimersByTimeAsync(4_600);
    const result = await promise;

    expect(result.command).toBeNull();
    expect(result.fromLLM).toBe(false);
  });

  // ── API error ──────────────────────────────────────────────────────────────

  it('5. API error → returns null, fromLLM false', async () => {
    mockCreate.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await resolveLLMIntent('api error test message');
    expect(result.command).toBeNull();
    expect(result.fromLLM).toBe(false);
  });

  // ── No tool_use block ──────────────────────────────────────────────────────

  it('6. no tool_use block in response → returns null', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I think you want /cost' }],
      usage: { cache_read_input_tokens: 0 },
    });
    const result = await resolveLLMIntent('some ambiguous message here');
    expect(result.command).toBeNull();
    expect(result.fromLLM).toBe(false);
  });

  // ── Hallucination guard ────────────────────────────────────────────────────

  it('7. hallucinated command not in allowlist → null', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolUseResponse('/nonexistent', 0.99, 'made up command'),
    );
    const result = await resolveLLMIntent('do something mysterious');
    expect(result.command).toBeNull();
  });

  // ── Bypass guards ──────────────────────────────────────────────────────────

  it('8. message >80 chars → LLM skip, mockCreate NOT called', async () => {
    const longMessage = 'x'.repeat(81);
    const result = await resolveLLMIntent(longMessage);
    expect(result.command).toBeNull();
    expect(result.fromLLM).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('8b. message >6 words → LLM skip, mockCreate NOT called', async () => {
    const longSentence = 'auth modulundeki hatayi hemen simdi lutfen duzelt';
    const result = await resolveLLMIntent(longSentence);
    expect(result.command).toBeNull();
    expect(result.fromLLM).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('9. empty minimaxApiKey → LLM skip, mockCreate NOT called', async () => {
    mockConfig.minimaxApiKey = '';
    const result = await resolveLLMIntent('ne kadar harcadım bu ay acaba');
    expect(result.command).toBeNull();
    expect(result.fromLLM).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── Destructive command thresholds ─────────────────────────────────────────

  it('10. /clear with confidence 0.95 (≥0.90) → returns /clear', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse('/clear', 0.95, 'clear intent'));
    const result = await resolveLLMIntent('konuşmayı sıfırla lütfen');
    expect(result.command).toBe('/clear');
  });

  it('11. /clear with confidence 0.85 (<0.90 destructive threshold) → returns null', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse('/clear', 0.85, 'maybe clear'));
    const result = await resolveLLMIntent('bir şeyleri temizle mi');
    expect(result.command).toBeNull();
  });

  // ── Circuit breaker ────────────────────────────────────────────────────────

  it('12. circuit breaker opens after 3 consecutive failures', async () => {
    mockCreate.mockRejectedValue(new Error('fail'));

    await resolveLLMIntent('circuit fail 1');
    await resolveLLMIntent('circuit fail 2');
    await resolveLLMIntent('circuit fail 3');

    // 4th call: circuit open → mockCreate NOT called
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce(makeToolUseResponse('/cost', 0.99, 'would succeed'));
    const result = await resolveLLMIntent('circuit fail 4');

    expect(result.command).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  // ── API call parameters ────────────────────────────────────────────────────

  it('13. uses tool_choice: { type: "any" }', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse('/cost', 0.9, 'test'));
    await resolveLLMIntent('param check tool_choice');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'any' },
      }),
    );
  });

  it('14. uses MiniMax-M2.5 model', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse('/status', 0.9, 'test'));
    await resolveLLMIntent('param check model');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'MiniMax-M2.5',
      }),
    );
  });

  it('15. system prompt has cache_control: ephemeral', async () => {
    mockCreate.mockResolvedValueOnce(makeToolUseResponse('/help', 0.9, 'test'));
    await resolveLLMIntent('param check cache control');
    const callArgs = mockCreate.mock.calls[0][0];
    const systemArr: Array<{ type: string; cache_control?: { type: string } }> =
      callArgs.system;
    expect(Array.isArray(systemArr)).toBe(true);
    expect(systemArr[0]).toMatchObject({
      type: 'text',
      cache_control: { type: 'ephemeral' },
    });
  });
});
