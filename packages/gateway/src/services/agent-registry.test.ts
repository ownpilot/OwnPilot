import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAgentRegistry,
  resetAgentRegistry,
  type AgentTypeAdapter,
  type AgentSummary,
} from './agent-registry.js';

function createMockSummary(overrides: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id: 'test-agent-1',
    type: 'regular',
    name: 'Test Agent',
    state: 'running',
    userId: 'user-1',
    startedAt: new Date(),
    metrics: { tokensUsed: 100, toolCallsUsed: 5, costUsd: 0.01, durationMs: 1000 },
    ...overrides,
  };
}

describe('AgentRegistry', () => {
  beforeEach(() => {
    resetAgentRegistry();
  });

  it('returns empty list when no adapters registered', () => {
    const registry = getAgentRegistry();
    expect(registry.listAll()).toEqual([]);
  });

  it('lists agents from registered adapters', () => {
    const registry = getAgentRegistry();
    const summary = createMockSummary();
    const adapter: AgentTypeAdapter = {
      type: 'regular',
      listActive: () => [summary],
      get: () => summary,
      cancel: vi.fn().mockResolvedValue(true),
    };
    registry.registerAdapter(adapter);
    expect(registry.listAll()).toEqual([summary]);
  });

  it('filters by userId', () => {
    const registry = getAgentRegistry();
    const adapter: AgentTypeAdapter = {
      type: 'background',
      listActive: vi.fn().mockReturnValue([createMockSummary({ type: 'background' })]),
      get: vi.fn().mockReturnValue(null),
      cancel: vi.fn().mockResolvedValue(false),
    };
    registry.registerAdapter(adapter);
    registry.listAll('user-1');
    expect(adapter.listActive).toHaveBeenCalledWith('user-1');
  });

  it('gets agent by type and id', () => {
    const registry = getAgentRegistry();
    const summary = createMockSummary({ type: 'subagent', id: 'sub-1' });
    const adapter: AgentTypeAdapter = {
      type: 'subagent',
      listActive: () => [],
      get: (id, userId) => (id === 'sub-1' && userId === 'user-1' ? summary : null),
      cancel: vi.fn().mockResolvedValue(true),
    };
    registry.registerAdapter(adapter);
    expect(registry.get('subagent', 'sub-1', 'user-1')).toEqual(summary);
    expect(registry.get('subagent', 'unknown', 'user-1')).toBeNull();
    expect(registry.get('coding', 'sub-1', 'user-1')).toBeNull();
  });

  it('cancels agent via adapter', async () => {
    const registry = getAgentRegistry();
    const cancelFn = vi.fn().mockResolvedValue(true);
    registry.registerAdapter({
      type: 'coding',
      listActive: () => [],
      get: () => null,
      cancel: cancelFn,
    });
    const result = await registry.cancel('coding', 'session-1', 'user-1');
    expect(result).toBe(true);
    expect(cancelFn).toHaveBeenCalledWith('session-1', 'user-1');
  });

  it('returns false when cancelling unknown type', async () => {
    const registry = getAgentRegistry();
    const result = await registry.cancel('orchestra', 'id', 'user');
    expect(result).toBe(false);
  });

  it('computes system metrics across all adapters', () => {
    const registry = getAgentRegistry();
    registry.registerAdapter({
      type: 'regular',
      listActive: () => [
        createMockSummary({ metrics: { tokensUsed: 100, toolCallsUsed: 5, costUsd: 0.01, durationMs: 1000 } }),
      ],
      get: () => null,
      cancel: vi.fn().mockResolvedValue(false),
    });
    registry.registerAdapter({
      type: 'background',
      listActive: () => [
        createMockSummary({ type: 'background', metrics: { tokensUsed: 200, toolCallsUsed: 10, costUsd: 0.02, durationMs: 2000 } }),
        createMockSummary({ type: 'background', id: 'bg-2', metrics: { tokensUsed: 50, toolCallsUsed: 1, costUsd: 0.005, durationMs: 500 } }),
      ],
      get: () => null,
      cancel: vi.fn().mockResolvedValue(false),
    });

    const metrics = registry.getSystemMetrics();
    expect(metrics.totalActive).toBe(3);
    expect(metrics.byType.regular).toBe(1);
    expect(metrics.byType.background).toBe(2);
    expect(metrics.totalTokensUsed).toBe(350);
    expect(metrics.totalCostUsd).toBeCloseTo(0.035);
  });

  it('handles adapter errors gracefully', () => {
    const registry = getAgentRegistry();
    registry.registerAdapter({
      type: 'soul',
      listActive: () => { throw new Error('DB connection failed'); },
      get: () => null,
      cancel: vi.fn().mockResolvedValue(false),
    });
    // Should not throw, returns empty array
    expect(registry.listAll()).toEqual([]);
    // Metrics should still work (0 for failed adapter)
    const metrics = registry.getSystemMetrics();
    expect(metrics.totalActive).toBe(0);
  });

  it('is a singleton', () => {
    const r1 = getAgentRegistry();
    const r2 = getAgentRegistry();
    expect(r1).toBe(r2);
  });

  it('resets singleton', () => {
    const r1 = getAgentRegistry();
    r1.registerAdapter({
      type: 'regular',
      listActive: () => [createMockSummary()],
      get: () => null,
      cancel: vi.fn().mockResolvedValue(false),
    });
    resetAgentRegistry();
    const r2 = getAgentRegistry();
    expect(r2.listAll()).toEqual([]);
  });
});
