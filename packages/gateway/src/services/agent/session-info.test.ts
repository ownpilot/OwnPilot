import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent } from '@ownpilot/core/agent';
import type { Memory } from '@ownpilot/core/memory/memory.js';
import type { ConversationSummary } from '@ownpilot/core/memory/types.js';

const mockGetLLMRouter = vi.hoisted(() => vi.fn());
vi.mock('@ownpilot/core/services', () => ({
  getLLMRouter: mockGetLLMRouter,
}));

import { getSessionInfo } from './session-info.js';

function makeAgent(
  overrides: Partial<{
    conversation: Partial<ConversationSummary>;
    memoryStats: Partial<{ estimatedTokens: number; messageCount: number }>;
  }> = {}
): Agent {
  const conv = {
    id: 'sess-123',
    systemPrompt: 'You are helpful.',
    ...overrides.conversation,
  } as ConversationSummary;
  const stats = {
    estimatedTokens: 1000,
    messageCount: 5,
    ...overrides.memoryStats,
  };

  const memory = { getStats: vi.fn().mockReturnValue(stats) } as unknown as Memory;
  return {
    getConversation: vi.fn().mockReturnValue(conv),
    getMemory: vi.fn().mockReturnValue(memory),
  } as unknown as Agent;
}

describe('getSessionInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLLMRouter.mockReturnValue({
      getContextWindow: vi.fn().mockReturnValue(100000),
    });
  });

  it('returns session id from conversation', () => {
    const agent = makeAgent({ conversation: { id: 'sess-abc' } });
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest');
    expect(result.sessionId).toBe('sess-abc');
  });

  it('uses actualPromptTokens when provided and positive', () => {
    const agent = makeAgent();
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest', undefined, 5000);
    // actualPromptTokens takes precedence over estimate
    expect(result.estimatedTokens).toBe(5000);
  });

  it('falls back to system+message token estimate when actualPromptTokens not provided', () => {
    const agent = makeAgent();
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest');
    // systemPrompt.length / 4 = ceil(15/4) = 4, plus messageTokens = 1000
    expect(result.estimatedTokens).toBe(1004);
  });

  it('falls back to estimate when actualPromptTokens is 0', () => {
    const agent = makeAgent();
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest', undefined, 0);
    expect(result.estimatedTokens).toBe(1004);
  });

  it('returns 0 message count when stats are missing', () => {
    const memory = { getStats: vi.fn().mockReturnValue(undefined) } as unknown as Memory;
    const agent = {
      getConversation: vi.fn().mockReturnValue({ id: 'sess-1' }),
      getMemory: vi.fn().mockReturnValue(memory),
    } as unknown as Agent;
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest');
    expect(result.messageCount).toBe(0);
  });

  it('returns 0 contextFillPercent when maxCtx is 0', () => {
    mockGetLLMRouter.mockReturnValue({ getContextWindow: vi.fn().mockReturnValue(0) });
    const agent = makeAgent();
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest');
    expect(result.contextFillPercent).toBe(0);
  });

  it('caps contextFillPercent at 100', () => {
    mockGetLLMRouter.mockReturnValue({ getContextWindow: vi.fn().mockReturnValue(100) });
    const conv = { id: 'sess-1', systemPrompt: 'x' };
    const memory = {
      getStats: vi.fn().mockReturnValue({ estimatedTokens: 500, messageCount: 1 }),
    } as unknown as Memory;
    const agent = {
      getConversation: vi.fn().mockReturnValue(conv),
      getMemory: vi.fn().mockReturnValue(memory),
    } as unknown as Agent;

    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest');
    expect(result.contextFillPercent).toBe(100);
  });

  it('rounds contextFillPercent', () => {
    mockGetLLMRouter.mockReturnValue({ getContextWindow: vi.fn().mockReturnValue(1000) });
    // With systemPrompt = 'You are helpful.' (16 chars) → 4 tokens, + 200 tokens = 204
    // 204/1000 = 0.204 → Math.round = 20%
    const agent = makeAgent({
      memoryStats: { estimatedTokens: 200 },
    });
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest');
    expect(result.contextFillPercent).toBe(20);
  });

  it('uses contextWindowOverride when provided', () => {
    const mockGetContextWindow = vi.fn().mockReturnValue(200000);
    mockGetLLMRouter.mockReturnValue({ getContextWindow: mockGetContextWindow });
    const agent = makeAgent();
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest', 200000);
    expect(mockGetContextWindow).toHaveBeenCalledWith(
      'anthropic',
      'claude-3-5-sonnet-latest',
      200000
    );
    expect(result.maxContextTokens).toBe(200000);
  });

  it('uses 0 system tokens when systemPrompt is empty', () => {
    const agent = makeAgent({
      conversation: { systemPrompt: '' },
      memoryStats: { estimatedTokens: 500 },
    });
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest');
    // no system tokens, only message tokens
    expect(result.estimatedTokens).toBe(500);
  });

  it('uses 0 system tokens when systemPrompt is undefined', () => {
    const agent = makeAgent({
      conversation: { systemPrompt: undefined },
      memoryStats: { estimatedTokens: 500 },
    });
    const result = getSessionInfo(agent, 'anthropic', 'claude-3-5-sonnet-latest');
    expect(result.estimatedTokens).toBe(500);
  });
});
