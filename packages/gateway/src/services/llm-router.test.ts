/**
 * LLMRouter contract tests.
 *
 * The router is a facade — its job is to forward to the existing helpers
 * with the right argument shape. So this test mocks the underlying
 * helpers and asserts the router delegates with the correct translation
 * (positional args -> single options object for pick(), pass-through
 * for the rest).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const mockResolve = vi.fn();
const mockCost = vi.fn();
const mockCtx = vi.fn();
const mockMaxOut = vi.fn();
const mockMemBudget = vi.fn();

vi.mock('./agent/runner-utils.js', () => ({
  resolveProviderAndModel: mockResolve,
  calculateExecutionCost: mockCost,
}));

vi.mock('./agent/cache.js', () => ({
  resolveContextWindow: mockCtx,
  resolveMaxOutput: mockMaxOut,
  computeMemoryMaxTokens: mockMemBudget,
}));

const { installLLMRouter } = await import('./llm-router.js');
const { getLLMRouter } = await import('@ownpilot/core');

describe('LLMRouter facade', () => {
  beforeAll(() => {
    // Wire the gateway facade into the core singleton — production does
    // this in server.ts during boot.
    installLLMRouter();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the same singleton instance', () => {
    expect(getLLMRouter()).toBe(getLLMRouter());
  });

  describe('pick()', () => {
    it('translates options object to positional args with default process', async () => {
      mockResolve.mockResolvedValueOnce({ provider: 'anthropic', model: 'claude-3-opus' });

      const result = await getLLMRouter().pick({
        explicitProvider: 'anthropic',
        explicitModel: 'claude-3-opus',
      });

      expect(mockResolve).toHaveBeenCalledWith('anthropic', 'claude-3-opus', 'pulse', undefined);
      expect(result).toEqual({ provider: 'anthropic', model: 'claude-3-opus' });
    });

    it('forwards process and errorContext', async () => {
      mockResolve.mockResolvedValueOnce({ provider: 'openai', model: 'gpt-4' });

      await getLLMRouter().pick({
        process: 'chat',
        errorContext: 'unit test',
      });

      expect(mockResolve).toHaveBeenCalledWith(undefined, undefined, 'chat', 'unit test');
    });
  });

  describe('getContextWindow / getMaxOutput', () => {
    it('passes through to the underlying helper', () => {
      mockCtx.mockReturnValueOnce(200_000);
      mockMaxOut.mockReturnValueOnce(8192);

      const router = getLLMRouter();
      expect(router.getContextWindow('anthropic', 'claude-3-opus')).toBe(200_000);
      expect(router.getMaxOutput('anthropic', 'claude-3-opus')).toBe(8192);

      expect(mockCtx).toHaveBeenCalledWith('anthropic', 'claude-3-opus');
      expect(mockMaxOut).toHaveBeenCalledWith('anthropic', 'claude-3-opus');
    });

    it('forwards the userOverride argument', () => {
      mockCtx.mockReturnValueOnce(32_000);
      getLLMRouter().getContextWindow('openai', 'gpt-4', 32_000);
      expect(mockCtx).toHaveBeenCalledWith('openai', 'gpt-4', 32_000);
    });
  });

  describe('computeMemoryMaxTokens', () => {
    it('forwards the options object verbatim', () => {
      mockMemBudget.mockReturnValueOnce(64_000);
      const opts = { ctxWindow: 128_000, systemPromptTokens: 1000, outputBuffer: 4096 };

      const result = getLLMRouter().computeMemoryMaxTokens(opts);

      expect(result).toBe(64_000);
      expect(mockMemBudget).toHaveBeenCalledWith(opts);
    });
  });

  describe('calculateCost', () => {
    it('forwards provider, model, and usage', () => {
      mockCost.mockReturnValueOnce(0.0042);
      const usage = { promptTokens: 1000, completionTokens: 500 };

      const result = getLLMRouter().calculateCost('openai', 'gpt-4', usage);

      expect(result).toBe(0.0042);
      expect(mockCost).toHaveBeenCalledWith('openai', 'gpt-4', usage);
    });

    it('passes null usage through unchanged', () => {
      mockCost.mockReturnValueOnce(0);
      getLLMRouter().calculateCost('openai', 'gpt-4', null);
      expect(mockCost).toHaveBeenCalledWith('openai', 'gpt-4', null);
    });
  });
});
