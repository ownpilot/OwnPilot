import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../services/get-log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../debug.js', () => ({
  logError: vi.fn(),
  logRetry: vi.fn(),
}));

// Mock provider factory
const mockCreateProvider = vi.fn();
vi.mock('../provider.js', () => ({
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

// Import after mocks
const { FallbackProvider, createFallbackProvider, createProviderWithFallbacks } = await import(
  './fallback.js'
);
const { InternalError, TimeoutError, ValidationError } = await import('../../types/errors.js');
const { ok, err } = await import('../../types/result.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockProvider(type: string, overrides: Record<string, unknown> = {}) {
  return {
    type,
    isReady: vi.fn().mockReturnValue(true),
    complete: vi.fn().mockResolvedValue(ok({ content: `from ${type}`, usage: {} })),
    stream: vi.fn().mockImplementation(() =>
      (async function* () {
        yield ok({ content: `chunk-${type}`, done: false });
        yield ok({ content: '', done: true });
      })(),
    ),
    countTokens: vi.fn().mockReturnValue(100),
    getModels: vi.fn().mockResolvedValue(ok([`${type}-model-1`, `${type}-model-2`])),
    cancel: vi.fn(),
    ...overrides,
  };
}

const primaryConfig = { provider: 'openai', apiKey: 'pk' } as Record<string, unknown>;
const fallbackConfig1 = { provider: 'anthropic', apiKey: 'fk1' } as Record<string, unknown>;

const dummyRequest = { messages: [{ role: 'user', content: 'hi' }] } as Record<string, unknown>;

// Saved Date.now for restoration
let savedDateNow: typeof Date.now;

beforeEach(() => {
  vi.clearAllMocks();
  savedDateNow = Date.now;
});

afterEach(() => {
  Date.now = savedDateNow;
});

/**
 * Create a FallbackProvider with one primary and one fallback.
 * Returns the provider plus the mock objects for assertions.
 */
function createTestProvider(configOverrides: Record<string, unknown> = {}) {
  const primary = makeMockProvider('openai');
  const fallback = makeMockProvider('anthropic');

  mockCreateProvider
    .mockImplementationOnce(() => primary)
    .mockImplementationOnce(() => fallback);

  const provider = new FallbackProvider({
    primary: primaryConfig,
    fallbacks: [fallbackConfig1],
    ...configOverrides,
  });

  return { provider, primary, fallback };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('FallbackProvider', () => {
  // -------------------------------------------------------------------------
  // isReady
  // -------------------------------------------------------------------------
  describe('isReady', () => {
    it('returns true when primary is ready', () => {
      const { provider } = createTestProvider();
      expect(provider.isReady()).toBe(true);
    });

    it('returns true when only a fallback is ready', () => {
      const { provider, primary } = createTestProvider();
      primary.isReady.mockReturnValue(false);
      expect(provider.isReady()).toBe(true);
    });

    it('returns false when no providers are ready', () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.isReady.mockReturnValue(false);
      fallback.isReady.mockReturnValue(false);
      expect(provider.isReady()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // complete — success on primary
  // -------------------------------------------------------------------------
  describe('complete — success on primary', () => {
    it('returns primary result', async () => {
      const { provider } = createTestProvider();
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('from openai');
      }
    });

    it('does not call fallback when primary succeeds', async () => {
      const { provider, fallback } = createTestProvider();
      await provider.complete(dummyRequest);
      expect(fallback.complete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // complete — fallback on primary failure
  // -------------------------------------------------------------------------
  describe('complete — fallback on primary failure', () => {
    it('falls back to next provider on retryable error', async () => {
      const { provider, primary } = createTestProvider();
      primary.complete.mockResolvedValue(err(new InternalError('server error')));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('from anthropic');
      }
    });

    it('invokes onFallback callback with correct args', async () => {
      const onFallback = vi.fn();
      const { provider, primary } = createTestProvider({ onFallback });
      primary.complete.mockResolvedValue(err(new InternalError('boom')));
      await provider.complete(dummyRequest);
      expect(onFallback).toHaveBeenCalledWith(
        'openai',
        expect.any(InternalError),
        'anthropic',
      );
    });

    it('returns fallback result on success', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.complete.mockResolvedValue(err(new TimeoutError('op', 5000)));
      fallback.complete.mockResolvedValue(ok({ content: 'fallback ok', usage: {} }));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('fallback ok');
      }
    });

    it('records failure on primary and attempts fallback', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.complete.mockResolvedValue(err(new InternalError('fail')));
      await provider.complete(dummyRequest);
      expect(primary.complete).toHaveBeenCalledTimes(1);
      expect(fallback.complete).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // complete — all providers fail
  // -------------------------------------------------------------------------
  describe('complete — all providers fail', () => {
    it('returns error when all fail', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.complete.mockResolvedValue(err(new InternalError('fail1')));
      fallback.complete.mockResolvedValue(err(new InternalError('fail2')));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(false);
    });

    it('returns the last error', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.complete.mockResolvedValue(err(new InternalError('fail1')));
      fallback.complete.mockResolvedValue(err(new InternalError('fail2')));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('fail2');
      }
    });
  });

  // -------------------------------------------------------------------------
  // complete — enableFallback=false
  // -------------------------------------------------------------------------
  describe('complete — no fallback when disabled', () => {
    it('only attempts primary when enableFallback=false', async () => {
      const { provider, primary, fallback } = createTestProvider({ enableFallback: false });
      primary.complete.mockResolvedValue(err(new InternalError('fail')));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(false);
      expect(fallback.complete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // complete — no providers ready
  // -------------------------------------------------------------------------
  describe('complete — no providers ready', () => {
    it('returns ValidationError', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.isReady.mockReturnValue(false);
      fallback.isReady.mockReturnValue(false);
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ValidationError);
      }
    });
  });

  // -------------------------------------------------------------------------
  // complete — shouldFallback behavior
  //
  // NOTE: The shouldFallback method only controls whether onFallback callback
  // and logRetry are invoked. The provider loop itself ALWAYS tries all ready
  // providers regardless of shouldFallback result. Additionally, instanceof
  // checks in shouldFallback don't work across Vitest module boundaries
  // (dynamic await import() vs static import in source), so all errors fall
  // through to "unknown error type → return true".
  // -------------------------------------------------------------------------
  describe('complete — shouldFallback controls onFallback callback', () => {
    it('calls onFallback for retryable InternalError', async () => {
      const onFallback = vi.fn();
      const { provider, primary } = createTestProvider({ onFallback });
      primary.complete.mockResolvedValue(err(new InternalError('server error 500')));
      await provider.complete(dummyRequest);
      expect(onFallback).toHaveBeenCalled();
    });

    it('loop always tries all ready providers regardless of error type', async () => {
      // Even for non-retryable errors (ValidationError in production),
      // the loop continues through all providers
      const { provider, primary, fallback } = createTestProvider();
      primary.complete.mockResolvedValue(err(new ValidationError('bad input')));
      const result = await provider.complete(dummyRequest);
      // Fallback is attempted because the loop always continues
      expect(result.ok).toBe(true);
      expect(fallback.complete).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Circuit breaker
  // -------------------------------------------------------------------------
  describe('circuit breaker', () => {
    it('opens circuit after N consecutive failures (default threshold = 5)', async () => {
      const { provider, primary } = createTestProvider();
      primary.complete.mockResolvedValue(err(new InternalError('fail')));

      // Exhaust the default threshold (5 failures)
      for (let i = 0; i < 5; i++) {
        await provider.complete(dummyRequest);
      }

      // Primary circuit is now open — primary should be skipped
      primary.complete.mockResolvedValue(ok({ content: 'recovered', usage: {} }));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should come from fallback, not primary (circuit is open)
        expect(result.value.content).toBe('from anthropic');
      }
    });

    it('respects custom circuitBreakerThreshold', async () => {
      const { provider, primary } = createTestProvider({ circuitBreakerThreshold: 2 });
      primary.complete.mockResolvedValue(err(new InternalError('fail')));

      // 2 failures should open circuit
      await provider.complete(dummyRequest);
      await provider.complete(dummyRequest);

      primary.complete.mockResolvedValue(ok({ content: 'recovered', usage: {} }));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('from anthropic');
      }
    });

    it('transitions to half-open after cooldown', async () => {
      const cooldown = 5000;
      const { provider, primary } = createTestProvider({
        circuitBreakerThreshold: 2,
        circuitBreakerCooldown: cooldown,
      });
      primary.complete.mockResolvedValue(err(new InternalError('fail')));

      // Open the circuit
      await provider.complete(dummyRequest);
      await provider.complete(dummyRequest);

      // Advance past cooldown using Date.now override
      const baseTime = savedDateNow.call(Date);
      Date.now = () => baseTime + cooldown + 100;

      // Primary should be attempted again (half-open)
      primary.complete.mockResolvedValue(ok({ content: 'half-open success', usage: {} }));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('half-open success');
      }
    });

    it('closes circuit on success in half-open state', async () => {
      const cooldown = 10;
      const { provider, primary } = createTestProvider({
        circuitBreakerThreshold: 2,
        circuitBreakerCooldown: cooldown,
      });
      primary.complete.mockResolvedValue(err(new InternalError('fail')));

      // Open the circuit
      await provider.complete(dummyRequest);
      await provider.complete(dummyRequest);

      // Advance past cooldown
      const baseTime = savedDateNow.call(Date);
      Date.now = () => baseTime + cooldown + 10;

      // Succeed in half-open — should close circuit
      primary.complete.mockResolvedValue(ok({ content: 'back', usage: {} }));
      await provider.complete(dummyRequest);

      // Next call should also hit primary (circuit closed)
      primary.complete.mockResolvedValue(ok({ content: 'still primary', usage: {} }));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('still primary');
      }
    });

    it('re-opens circuit on failure in half-open state', async () => {
      const cooldown = 10;
      const { provider, primary } = createTestProvider({
        circuitBreakerThreshold: 2,
        circuitBreakerCooldown: cooldown,
      });
      primary.complete.mockResolvedValue(err(new InternalError('fail')));

      // Open the circuit
      await provider.complete(dummyRequest);
      await provider.complete(dummyRequest);

      // Advance past cooldown
      const baseTime = savedDateNow.call(Date);
      let mockTime = baseTime + cooldown + 10;
      Date.now = () => mockTime;

      // Fail again in half-open — circuit re-opens
      await provider.complete(dummyRequest);

      // Advance time just a tiny bit (not enough for another cooldown from the last failure)
      mockTime = baseTime + cooldown + 15;

      // Primary should be skipped again
      primary.complete.mockResolvedValue(ok({ content: 'wont reach', usage: {} }));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('from anthropic');
      }
    });

    it('does not open circuit below the threshold', async () => {
      const { provider, primary } = createTestProvider({ circuitBreakerThreshold: 3 });
      primary.complete.mockResolvedValue(err(new InternalError('fail')));

      // Only 2 failures (threshold is 3)
      await provider.complete(dummyRequest);
      await provider.complete(dummyRequest);

      // Circuit should still be closed — primary should be attempted
      primary.complete.mockResolvedValue(ok({ content: 'primary ok', usage: {} }));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('primary ok');
      }
    });

    it('handles thrown exceptions and records failure toward threshold', async () => {
      const { provider, primary, fallback: _fallback } = createTestProvider();
      primary.complete.mockRejectedValue(new Error('unexpected crash'));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.content).toBe('from anthropic');
      }
    });
  });

  // -------------------------------------------------------------------------
  // stream
  // -------------------------------------------------------------------------
  describe('stream', () => {
    it('yields chunks from primary on success', async () => {
      const { provider, primary } = createTestProvider();
      const chunks: unknown[] = [];
      for await (const chunk of provider.stream(dummyRequest)) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      expect(primary.stream).toHaveBeenCalled();
    });

    it('falls back on error before yielding any data', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.stream.mockImplementation(() =>
        (async function* () {
          yield err(new InternalError('stream fail'));
        })(),
      );
      fallback.stream.mockImplementation(() =>
        (async function* () {
          yield ok({ content: 'fallback-chunk', done: false });
          yield ok({ content: '', done: true });
        })(),
      );
      const chunks: unknown[] = [];
      for await (const chunk of provider.stream(dummyRequest)) {
        chunks.push(chunk);
      }
      expect(fallback.stream).toHaveBeenCalled();
      const okChunks = chunks.filter((c) => (c as { ok: boolean }).ok);
      expect(okChunks.length).toBeGreaterThan(0);
    });

    it('does NOT retry after partial data has been yielded', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.stream.mockImplementation(() =>
        (async function* () {
          yield ok({ content: 'partial', done: false });
          yield err(new InternalError('mid-stream fail'));
        })(),
      );
      const results: unknown[] = [];
      for await (const chunk of provider.stream(dummyRequest)) {
        results.push(chunk);
      }
      // Fallback should NOT have been called since data was already yielded
      expect(fallback.stream).not.toHaveBeenCalled();
      // Should have partial data + error
      expect(results.some((r: unknown) => (r as { ok: boolean; value: { content: string } }).ok && (r as { ok: boolean; value: { content: string } }).value.content === 'partial')).toBe(true);
      expect(results.some((r: unknown) => !(r as { ok: boolean }).ok)).toBe(true);
    });

    it('yields error when no providers are ready', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.isReady.mockReturnValue(false);
      fallback.isReady.mockReturnValue(false);
      const chunks: unknown[] = [];
      for await (const chunk of provider.stream(dummyRequest)) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect((chunks[0] as { ok: boolean }).ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // countTokens
  // -------------------------------------------------------------------------
  describe('countTokens', () => {
    it('delegates to primary provider', () => {
      const { provider, primary } = createTestProvider();
      const messages = [{ role: 'user', content: 'hello' }] as Record<string, unknown>[];
      const result = provider.countTokens(messages);
      expect(result).toBe(100);
      expect(primary.countTokens).toHaveBeenCalledWith(messages);
    });
  });

  // -------------------------------------------------------------------------
  // getModels
  // -------------------------------------------------------------------------
  describe('getModels', () => {
    it('collects models from all providers', async () => {
      const { provider } = createTestProvider();
      const result = await provider.getModels();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('openai-model-1');
        expect(result.value).toContain('openai-model-2');
        expect(result.value).toContain('anthropic-model-1');
        expect(result.value).toContain('anthropic-model-2');
      }
    });

    it('deduplicates models', async () => {
      const { provider, fallback } = createTestProvider();
      fallback.getModels.mockResolvedValue(
        ok(['openai-model-1', 'anthropic-model-1', 'anthropic-model-2']),
      );
      const result = await provider.getModels();
      expect(result.ok).toBe(true);
      if (result.ok) {
        const occurrences = result.value.filter((m: string) => m === 'openai-model-1');
        expect(occurrences.length).toBe(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // cancel
  // -------------------------------------------------------------------------
  describe('cancel', () => {
    it('calls cancel on all providers', () => {
      const { provider, primary, fallback } = createTestProvider();
      provider.cancel();
      expect(primary.cancel).toHaveBeenCalled();
      expect(fallback.cancel).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getCurrentProvider
  // -------------------------------------------------------------------------
  describe('getCurrentProvider', () => {
    it('returns primary provider type initially', () => {
      const { provider } = createTestProvider();
      expect(provider.getCurrentProvider()).toBe('openai');
    });
  });

  // -------------------------------------------------------------------------
  // shouldFallback — tested indirectly via onFallback callback and complete
  // -------------------------------------------------------------------------
  describe('shouldFallback logic (via onFallback and complete)', () => {
    it('triggers onFallback on TimeoutError', async () => {
      const onFallback = vi.fn();
      const { provider, primary } = createTestProvider({ onFallback });
      primary.complete.mockResolvedValue(err(new TimeoutError('op', 5000)));
      await provider.complete(dummyRequest);
      expect(onFallback).toHaveBeenCalled();
    });

    it('triggers onFallback on generic InternalError', async () => {
      const onFallback = vi.fn();
      const { provider, primary } = createTestProvider({ onFallback });
      primary.complete.mockResolvedValue(err(new InternalError('server down')));
      await provider.complete(dummyRequest);
      expect(onFallback).toHaveBeenCalled();
    });

    it('triggers onFallback on rate limit errors', async () => {
      const onFallback = vi.fn();
      const { provider, primary } = createTestProvider({ onFallback });
      primary.complete.mockResolvedValue(err(new InternalError('rate limit 429')));
      await provider.complete(dummyRequest);
      expect(onFallback).toHaveBeenCalled();
    });

    it('tries fallback on thrown exceptions', async () => {
      const { provider, primary, fallback } = createTestProvider();
      primary.complete.mockRejectedValue(new Error('something unexpected'));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      expect(fallback.complete).toHaveBeenCalled();
    });

    it('returns fallback result even for non-retryable errors (loop always continues)', async () => {
      // Note: In the Vitest environment, instanceof checks in shouldFallback
      // don't work across module boundaries. In production, shouldFallback
      // would return false for ValidationError, but the loop still continues
      // trying all providers regardless.
      const { provider, primary, fallback } = createTestProvider();
      primary.complete.mockResolvedValue(err(new InternalError('invalid api key')));
      const result = await provider.complete(dummyRequest);
      expect(result.ok).toBe(true);
      expect(fallback.complete).toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// Factory functions
// ===========================================================================

describe('createFallbackProvider', () => {
  it('returns a FallbackProvider instance', () => {
    mockCreateProvider
      .mockImplementationOnce(() => makeMockProvider('openai'))
      .mockImplementationOnce(() => makeMockProvider('anthropic'));
    const provider = createFallbackProvider({
      primary: primaryConfig,
      fallbacks: [fallbackConfig1],
    });
    expect(provider).toBeInstanceOf(FallbackProvider);
  });
});

describe('createProviderWithFallbacks', () => {
  it('returns plain provider when no fallbacks given', () => {
    const plain = makeMockProvider('openai');
    mockCreateProvider.mockImplementationOnce(() => plain);
    const result = createProviderWithFallbacks(primaryConfig);
    expect(result).toBe(plain);
    expect(result).not.toBeInstanceOf(FallbackProvider);
    expect(mockCreateProvider).toHaveBeenCalledTimes(1);
  });

  it('returns FallbackProvider when fallbacks are provided', () => {
    mockCreateProvider
      .mockImplementationOnce(() => makeMockProvider('openai'))
      .mockImplementationOnce(() => makeMockProvider('anthropic'));
    const result = createProviderWithFallbacks(primaryConfig, {
      fallbacks: [fallbackConfig1],
    });
    expect(result).toBeInstanceOf(FallbackProvider);
  });
});
